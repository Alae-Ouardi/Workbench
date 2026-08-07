use std::str::FromStr;

use rusqlite::{params, types::Type, OptionalExtension};

use crate::db::{now, Db};
use crate::error::{Error, Result};
use crate::types::{
    Comment, Event, Kind, NewTask, Priority, Status, StatusChange, Task, TaskDetail, TaskFilter,
    TaskRef,
};

const TASK_COLUMNS: &str = "t.id, t.project_id, p.name, t.title, t.description, t.status, \
     t.kind, t.assignee, t.priority, t.position, t.created_at, t.updated_at, \
     t.tp_entity_id, t.tp_entity_type, t.estimate_points, t.tp_sync_state, \
     t.tp_sync_error, t.tp_time_logged";

/// Optional field updates for an existing task.
#[derive(Debug, Clone, Default)]
pub struct TaskUpdate {
    pub title: Option<String>,
    pub description: Option<String>,
    pub assignee: Option<String>,
    pub priority: Option<Priority>,
    pub position: Option<f64>,
    pub estimate_points: Option<f64>,
}

impl Db {
    /// Create a single task in the given project. If the task has unfinished
    /// dependencies it starts as `waiting`, otherwise `open`.
    pub fn create_task(&self, project_id: i64, new: &NewTask, actor: &str) -> Result<Task> {
        let tx = self.conn.unchecked_transaction()?;
        let task = self.insert_task(project_id, new, actor)?;
        tx.commit()?;
        Ok(task)
    }

    /// Create a batch of tasks (e.g. an AI planning a topic). Entries may
    /// reference earlier entries in the same batch via `depends_on` using
    /// negative one-based indexes: -1 = first task in the batch, -2 = second…
    /// Positive values are existing task IDs.
    pub fn create_tasks(
        &self,
        project_id: i64,
        new_tasks: &[NewTask],
        actor: &str,
    ) -> Result<Vec<Task>> {
        let tx = self.conn.unchecked_transaction()?;
        let mut created: Vec<Task> = Vec::with_capacity(new_tasks.len());
        for new in new_tasks {
            let mut resolved = new.clone();
            resolved.depends_on = new
                .depends_on
                .iter()
                .map(|&dep| {
                    if dep < 0 {
                        let idx = (-dep - 1) as usize;
                        created
                            .get(idx)
                            .map(|t: &Task| t.id)
                            .ok_or(Error::TaskNotFound(dep))
                    } else {
                        Ok(dep)
                    }
                })
                .collect::<Result<Vec<i64>>>()?;
            created.push(self.insert_task(project_id, &resolved, actor)?);
        }
        tx.commit()?;
        Ok(created)
    }

    fn insert_task(&self, project_id: i64, new: &NewTask, actor: &str) -> Result<Task> {
        // Verify the project exists; the caller must supply a valid project_id.
        self.find_project(&project_id.to_string())?;
        let ts = now();
        let priority = new.priority.unwrap_or(Priority::Normal);
        let kind = new.kind.unwrap_or(Kind::Task);
        let estimate = new.estimate_points.unwrap_or(0.0).max(0.0);
        self.conn.execute(
            "INSERT INTO tasks (project_id, title, description, status, kind, assignee, priority, position, created_at, updated_at, tp_entity_type, estimate_points)
             VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?6, 0, ?7, ?7, ?8, ?9)",
            params![project_id, new.title, new.description, kind.as_str(), new.assignee, priority.as_str(), ts, tp_entity_type(kind), estimate],
        )?;
        let id = self.conn.last_insert_rowid();
        self.conn.execute(
            "UPDATE tasks SET position = ?1 WHERE id = ?2",
            params![id as f64, id],
        )?;
        self.record_event(id, actor, "created", &new.title)?;
        if !new.depends_on.is_empty() {
            self.replace_dependencies(id, &new.depends_on, actor)?;
        }
        self.enqueue_tp_create(project_id, id)?;
        self.get_task_row(id)
    }

    /// The linked project to mirror changes to, or `None` when this project is
    /// not connected to TargetProcess.
    ///
    /// Deliberately decided from the database alone. Queueing records *what
    /// happened*; whether and how to push it — the master switch, the state-name
    /// mapping — is settings, applied when the queue is drained. That keeps the
    /// write path free of file I/O and makes it deterministic in tests.
    fn tp_target(&self, project_id: i64) -> Result<Option<crate::types::Project>> {
        let project = self.project_by_id(project_id)?;
        if project.tp_user_story_id.is_none() || !project.tp_sync_enabled {
            return Ok(None);
        }
        Ok(Some(project))
    }

    /// Mirror a new task into TargetProcess, if its project is linked. Runs in
    /// the caller's transaction, so a rolled-back task takes its queue row with
    /// it.
    fn enqueue_tp_create(&self, project_id: i64, task_id: i64) -> Result<()> {
        let Some(project) = self.tp_target(project_id)? else {
            return Ok(());
        };
        let Some(user_story_id) = project.tp_user_story_id else {
            return Ok(());
        };
        self.enqueue_task_op(
            crate::tp::queue::SyncOp::CreateEntity,
            project_id,
            task_id,
            &serde_json::json!({ "user_story_id": user_story_id }),
        )?;
        Ok(())
    }

    pub fn get_task(&self, id: i64) -> Result<TaskDetail> {
        let task = self.get_task_row(id)?;
        Ok(TaskDetail {
            depends_on: self.task_refs(
                "SELECT t.id, t.title, t.status FROM task_dependencies d
                 JOIN tasks t ON t.id = d.depends_on_id WHERE d.task_id = ?1",
                id,
            )?,
            blocks: self.task_refs(
                "SELECT t.id, t.title, t.status FROM task_dependencies d
                 JOIN tasks t ON t.id = d.task_id WHERE d.depends_on_id = ?1",
                id,
            )?,
            comments: self.list_comments(id)?,
            events: self.list_events(id)?,
            task,
        })
    }

    pub fn list_tasks(&self, filter: &TaskFilter) -> Result<Vec<Task>> {
        let mut sql = format!(
            "SELECT {TASK_COLUMNS} FROM tasks t JOIN projects p ON p.id = t.project_id WHERE 1=1"
        );
        let mut args: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(pid) = filter.project_id {
            sql.push_str(" AND t.project_id = ?");
            args.push(Box::new(pid));
        }
        if let Some(status) = filter.status {
            sql.push_str(" AND t.status = ?");
            args.push(Box::new(status.as_str().to_string()));
        }
        if let Some(ref assignee) = filter.assignee {
            sql.push_str(" AND t.assignee = ?");
            args.push(Box::new(assignee.clone()));
        }
        sql.push_str(
            " ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 \
              WHEN 'normal' THEN 2 ELSE 3 END, t.position, t.id",
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(args.iter()), row_to_task)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Change a task's status. When a task is marked `done`, any `waiting`
    /// tasks whose dependencies are now all done are auto-promoted to `open`.
    pub fn set_status(&self, id: i64, status: Status, actor: &str) -> Result<StatusChange> {
        let tx = self.conn.unchecked_transaction()?;
        let before = self.get_task_row(id)?;
        let ts = now();
        self.conn.execute(
            "UPDATE tasks SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status.as_str(), ts, id],
        )?;
        if before.status != status {
            self.record_event(
                id,
                actor,
                "status_changed",
                &format!("{} -> {}", before.status, status),
            )?;
        }
        let promoted = if status == Status::Done {
            self.promote_unblocked_dependents(id, actor)?
        } else {
            Vec::new()
        };
        let task = self.get_task_row(id)?;
        if before.status != status {
            self.enqueue_tp_status(&task)?;
        }
        tx.commit()?;
        Ok(StatusChange { task, promoted })
    }

    /// Record a status change for TargetProcess when the project is linked.
    /// Completing a task also queues its estimate as a time entry.
    ///
    /// `open` and `waiting` are skipped because they have no TargetProcess
    /// counterpart — a freshly created entity already sits in the initial state.
    /// Whether `in_progress` / `review` actually map to a state is decided at
    /// drain time from the settings, which drop the row when they don't.
    fn enqueue_tp_status(&self, task: &Task) -> Result<()> {
        let Some(project) = self.tp_target(task.project_id)? else {
            return Ok(());
        };
        match task.status {
            Status::Done => {
                self.enqueue_completion_ops(task, project.id)?;
            }
            Status::InProgress | Status::Review => {
                self.enqueue_task_op(
                    crate::tp::queue::SyncOp::SetState,
                    project.id,
                    task.id,
                    &serde_json::json!({ "status": task.status.as_str() }),
                )?;
            }
            Status::Open | Status::Waiting => {}
        }
        Ok(())
    }

    pub fn update_task(&self, id: i64, update: &TaskUpdate, actor: &str) -> Result<Task> {
        let tx = self.conn.unchecked_transaction()?;
        self.get_task_row(id)?; // ensure it exists
        let ts = now();
        if let Some(ref title) = update.title {
            self.conn.execute(
                "UPDATE tasks SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![title, ts, id],
            )?;
        }
        if let Some(ref description) = update.description {
            self.conn.execute(
                "UPDATE tasks SET description = ?1, updated_at = ?2 WHERE id = ?3",
                params![description, ts, id],
            )?;
        }
        if let Some(ref assignee) = update.assignee {
            self.conn.execute(
                "UPDATE tasks SET assignee = ?1, updated_at = ?2 WHERE id = ?3",
                params![assignee, ts, id],
            )?;
        }
        if let Some(priority) = update.priority {
            self.conn.execute(
                "UPDATE tasks SET priority = ?1, updated_at = ?2 WHERE id = ?3",
                params![priority.as_str(), ts, id],
            )?;
        }
        if let Some(position) = update.position {
            self.conn.execute(
                "UPDATE tasks SET position = ?1, updated_at = ?2 WHERE id = ?3",
                params![position, ts, id],
            )?;
        }
        if let Some(estimate) = update.estimate_points {
            self.conn.execute(
                "UPDATE tasks SET estimate_points = ?1, updated_at = ?2 WHERE id = ?3",
                params![estimate.max(0.0), ts, id],
            )?;
        }
        self.record_event(id, actor, "updated", "")?;
        let task = self.get_task_row(id)?;
        // Title and description are the two fields TargetProcess mirrors, so an
        // edit to either has to be pushed — otherwise the board keeps the text
        // the task was created with. Other fields are local-only.
        if update.title.is_some() || update.description.is_some() {
            self.enqueue_tp_update(&task)?;
        }
        tx.commit()?;
        Ok(task)
    }

    /// Push a mirrored task's current title, description, team and sprint.
    ///
    /// Skipped when the task has never been mirrored: its `create_entity` will
    /// send the current values anyway.
    pub(crate) fn enqueue_tp_update(&self, task: &Task) -> Result<()> {
        if task.tp_entity_id.is_none() {
            return Ok(());
        }
        let Some(project) = self.tp_target(task.project_id)? else {
            return Ok(());
        };
        if project.tp_user_story_id.is_none() {
            return Ok(());
        }
        self.enqueue_task_op(
            crate::tp::queue::SyncOp::UpdateEntity,
            task.project_id,
            task.id,
            &serde_json::json!({}),
        )?;
        Ok(())
    }

    pub fn delete_task(&self, id: i64) -> Result<()> {
        let n = self
            .conn
            .execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(Error::TaskNotFound(id));
        }
        Ok(())
    }

    pub fn add_comment(&self, task_id: i64, author: &str, body: &str) -> Result<Comment> {
        let tx = self.conn.unchecked_transaction()?;
        self.get_task_row(task_id)?;
        let ts = now();
        self.conn.execute(
            "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![task_id, author, body, ts],
        )?;
        let id = self.conn.last_insert_rowid();
        self.record_event(task_id, author, "commented", "")?;
        self.conn.execute(
            "UPDATE tasks SET updated_at = ?1 WHERE id = ?2",
            params![ts, task_id],
        )?;
        tx.commit()?;
        Ok(Comment {
            id,
            task_id,
            author: author.to_string(),
            body: body.to_string(),
            created_at: ts,
        })
    }

    /// Replace the dependency set of a task. The task's status is adjusted:
    /// `open` + unfinished deps -> `waiting`; `waiting` + all deps done -> `open`.
    pub fn set_dependencies(&self, task_id: i64, depends_on: &[i64], actor: &str) -> Result<Task> {
        let tx = self.conn.unchecked_transaction()?;
        self.get_task_row(task_id)?;
        self.replace_dependencies(task_id, depends_on, actor)?;
        let task = self.get_task_row(task_id)?;
        tx.commit()?;
        Ok(task)
    }

    fn replace_dependencies(&self, task_id: i64, depends_on: &[i64], actor: &str) -> Result<()> {
        for &dep in depends_on {
            if dep == task_id {
                return Err(Error::SelfDependency);
            }
            self.get_task_row(dep)?; // dependency must exist
            if self.would_create_cycle(task_id, dep)? {
                return Err(Error::DependencyCycle {
                    task_id,
                    depends_on_id: dep,
                });
            }
        }
        self.conn.execute(
            "DELETE FROM task_dependencies WHERE task_id = ?1",
            params![task_id],
        )?;
        for &dep in depends_on {
            self.conn.execute(
                "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?1, ?2)",
                params![task_id, dep],
            )?;
        }
        if !depends_on.is_empty() {
            self.record_event(
                task_id,
                actor,
                "dependencies_set",
                &depends_on
                    .iter()
                    .map(|d| format!("#{d}"))
                    .collect::<Vec<_>>()
                    .join(", "),
            )?;
        }
        // Adjust status to reflect the new dependency state.
        let unfinished = self.unfinished_dep_count(task_id)?;
        let current = self.get_task_row(task_id)?.status;
        let ts = now();
        if unfinished > 0 && current == Status::Open {
            self.conn.execute(
                "UPDATE tasks SET status = 'waiting', updated_at = ?1 WHERE id = ?2",
                params![ts, task_id],
            )?;
            self.record_event(task_id, actor, "status_changed", "open -> waiting")?;
        } else if unfinished == 0 && current == Status::Waiting {
            self.conn.execute(
                "UPDATE tasks SET status = 'open', updated_at = ?1 WHERE id = ?2",
                params![ts, task_id],
            )?;
            self.record_event(task_id, actor, "status_changed", "waiting -> open")?;
        }
        Ok(())
    }

    fn would_create_cycle(&self, task_id: i64, depends_on_id: i64) -> Result<bool> {
        // Cycle iff `task_id` is already (transitively) a dependency of `depends_on_id`.
        let exists: i64 = self.conn.query_row(
            "WITH RECURSIVE reach(id) AS (
                 SELECT depends_on_id FROM task_dependencies WHERE task_id = ?1
                 UNION
                 SELECT td.depends_on_id FROM task_dependencies td JOIN reach r ON td.task_id = r.id
             )
             SELECT EXISTS(SELECT 1 FROM reach WHERE id = ?2)",
            params![depends_on_id, task_id],
            |row| row.get(0),
        )?;
        Ok(exists != 0)
    }

    fn unfinished_dep_count(&self, task_id: i64) -> Result<i64> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM task_dependencies d
             JOIN tasks t ON t.id = d.depends_on_id
             WHERE d.task_id = ?1 AND t.status != 'done'",
            params![task_id],
            |row| row.get(0),
        )?;
        Ok(n)
    }

    fn promote_unblocked_dependents(&self, done_task_id: i64, actor: &str) -> Result<Vec<Task>> {
        let ids: Vec<i64> = {
            let mut stmt = self.conn.prepare(
                "SELECT d.task_id FROM task_dependencies d
                 JOIN tasks t ON t.id = d.task_id
                 WHERE d.depends_on_id = ?1 AND t.status = 'waiting'
                 AND NOT EXISTS (
                     SELECT 1 FROM task_dependencies d2
                     JOIN tasks dep ON dep.id = d2.depends_on_id
                     WHERE d2.task_id = d.task_id AND dep.status != 'done'
                 )",
            )?;
            let rows = stmt.query_map(params![done_task_id], |row| row.get(0))?;
            rows.collect::<std::result::Result<Vec<i64>, _>>()?
        };
        let mut promoted = Vec::with_capacity(ids.len());
        let ts = now();
        for id in ids {
            self.conn.execute(
                "UPDATE tasks SET status = 'open', updated_at = ?1 WHERE id = ?2",
                params![ts, id],
            )?;
            self.record_event(
                id,
                actor,
                "auto_promoted",
                &format!("dependencies done (last: #{done_task_id}), waiting -> open"),
            )?;
            promoted.push(self.get_task_row(id)?);
        }
        Ok(promoted)
    }

    fn record_event(&self, task_id: i64, actor: &str, kind: &str, detail: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO task_events (task_id, actor, kind, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![task_id, actor, kind, detail, now()],
        )?;
        Ok(())
    }

    fn get_task_row(&self, id: i64) -> Result<Task> {
        let sql = format!(
            "SELECT {TASK_COLUMNS} FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?1"
        );
        self.conn
            .query_row(&sql, params![id], row_to_task)
            .optional()?
            .ok_or(Error::TaskNotFound(id))
    }

    fn task_refs(&self, sql: &str, id: i64) -> Result<Vec<TaskRef>> {
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(params![id], |row| {
            Ok(TaskRef {
                id: row.get(0)?,
                title: row.get(1)?,
                status: parse_status(row, 2)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn list_comments(&self, task_id: i64) -> Result<Vec<Comment>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task_id, author, body, created_at FROM task_comments
             WHERE task_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![task_id], |row| {
            Ok(Comment {
                id: row.get(0)?,
                task_id: row.get(1)?,
                author: row.get(2)?,
                body: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    fn list_events(&self, task_id: i64) -> Result<Vec<Event>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, task_id, actor, kind, detail, created_at FROM task_events
             WHERE task_id = ?1 ORDER BY id",
        )?;
        let rows = stmt.query_map(params![task_id], |row| {
            Ok(Event {
                id: row.get(0)?,
                task_id: row.get(1)?,
                actor: row.get(2)?,
                kind: row.get(3)?,
                detail: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
}

/// The TargetProcess entity type a TaskBoard task of this kind mirrors to.
/// TP models defects as a separate `Bugs` collection rather than a task field.
pub(crate) fn tp_entity_type(kind: Kind) -> &'static str {
    match kind {
        Kind::Task => "Task",
        Kind::Bug => "Bug",
    }
}

fn parse_status(row: &rusqlite::Row<'_>, idx: usize) -> rusqlite::Result<Status> {
    let s: String = row.get(idx)?;
    Status::from_str(&s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            idx,
            Type::Text,
            Box::new(StringError(e.to_string())),
        )
    })
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let kind_str: String = row.get(6)?;
    let kind = Kind::from_str(&kind_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            6,
            Type::Text,
            Box::new(StringError(e.to_string())),
        )
    })?;
    let priority_str: String = row.get(8)?;
    let priority = Priority::from_str(&priority_str).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            8,
            Type::Text,
            Box::new(StringError(e.to_string())),
        )
    })?;
    Ok(Task {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        status: parse_status(row, 5)?,
        kind,
        assignee: row.get(7)?,
        priority,
        position: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        tp_entity_id: row.get(12)?,
        tp_entity_type: row.get(13)?,
        estimate_points: row.get(14)?,
        tp_sync_state: row.get(15)?,
        tp_sync_error: row.get(16)?,
        tp_time_logged: row.get(17)?,
    })
}

#[derive(Debug)]
struct StringError(String);

impl std::fmt::Display for StringError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for StringError {}
