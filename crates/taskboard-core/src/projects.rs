use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};

use crate::db::{now, Db};
use crate::error::{Error, Result};
use crate::types::{Briefing, Project, ProjectSummary, Status, Task, TaskFilter};

/// All `projects` columns, in the order `row_to_project` expects them.
const PROJECT_COLUMNS: &str = "id, name, path, created_at, original_request, plan_summary, \
     last_actor, last_session_id, handoff_note, current_task_id, handoff_updated_at";

/// Resolve a filesystem path to a canonical project root: the enclosing git
/// repository root if one exists, otherwise the canonicalized path itself.
/// Paths that do not exist on disk are used verbatim.
pub fn resolve_project_root(path: &str) -> String {
    let p = PathBuf::from(path);
    let canonical = p.canonicalize().unwrap_or(p);
    let mut dir: &Path = &canonical;
    loop {
        if dir.join(".git").exists() {
            return dir.to_string_lossy().into_owned();
        }
        match dir.parent() {
            Some(parent) if parent != dir => dir = parent,
            _ => break,
        }
    }
    canonical.to_string_lossy().into_owned()
}

fn project_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

impl Db {
    /// Find or create the project for `path` (resolved to its git root).
    pub fn ensure_project(&self, path: &str, name: Option<&str>) -> Result<Project> {
        let root = resolve_project_root(path);
        if let Some(existing) = self.find_project_by_path(&root)? {
            return Ok(existing);
        }
        let name = name
            .map(str::to_string)
            .unwrap_or_else(|| project_name_from_path(&root));
        let created_at = now();
        self.conn.execute(
            "INSERT INTO projects (name, path, created_at) VALUES (?1, ?2, ?3)",
            params![name, root, created_at],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Project {
            id,
            name,
            path: root,
            created_at,
            original_request: String::new(),
            plan_summary: String::new(),
            last_actor: String::new(),
            last_session_id: String::new(),
            handoff_note: String::new(),
            current_task_id: None,
            handoff_updated_at: None,
        })
    }

    /// Look up a single project by path. Errors if multiple projects share this
    /// path so callers must disambiguate with a project id or unique name.
    pub fn find_project_by_path(&self, path: &str) -> Result<Option<Project>> {
        let mut projects = self.find_projects_by_path(path)?;
        match projects.len() {
            0 => Ok(None),
            1 => Ok(Some(projects.remove(0))),
            _ => Err(Error::AmbiguousProject {
                key: path.to_string(),
                matches: projects
                    .into_iter()
                    .map(|p| format!("#{} {}", p.id, p.name))
                    .collect(),
            }),
        }
    }

    /// Return every project that points to the given path, newest first.
    pub fn find_projects_by_path(&self, path: &str) -> Result<Vec<Project>> {
        let root = resolve_project_root(path);
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {PROJECT_COLUMNS} FROM projects WHERE path = ?1 ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map(params![root], row_to_project)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Look up a project by id, exact path, or name (in that order).
    pub fn find_project(&self, key: &str) -> Result<Project> {
        if let Ok(id) = key.parse::<i64>() {
            if let Some(p) = self
                .conn
                .query_row(
                    &format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE id = ?1"),
                    params![id],
                    row_to_project,
                )
                .optional()?
            {
                return Ok(p);
            }
        }
        if let Some(p) = self.find_project_by_path(key)? {
            return Ok(p);
        }
        let mut by_name: Vec<Project> = {
            let mut stmt = self
                .conn
                .prepare(&format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE name = ?1"))?;
            let rows = stmt.query_map(params![key], row_to_project)?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        match by_name.len() {
            0 => Err(Error::ProjectNotFound(key.to_string())),
            1 => Ok(by_name.remove(0)),
            _ => Err(Error::AmbiguousProject {
                key: key.to_string(),
                matches: by_name
                    .into_iter()
                    .map(|p| format!("#{} {}", p.id, p.name))
                    .collect(),
            }),
        }
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>> {
        // Project columns first (indices 0..=10), then the five status counts.
        let prefixed: String = PROJECT_COLUMNS
            .split(", ")
            .map(|c| format!("p.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {prefixed},
                    SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.status = 'waiting' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.status = 'review' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END)
             FROM projects p
             LEFT JOIN tasks t ON t.project_id = p.id
             GROUP BY p.id
             ORDER BY p.name COLLATE NOCASE"
        ))?;
        let rows = stmt.query_map([], |row| {
            Ok(ProjectSummary {
                project: row_to_project(row)?,
                open: row.get::<_, Option<i64>>(11)?.unwrap_or(0),
                waiting: row.get::<_, Option<i64>>(12)?.unwrap_or(0),
                in_progress: row.get::<_, Option<i64>>(13)?.unwrap_or(0),
                review: row.get::<_, Option<i64>>(14)?.unwrap_or(0),
                done: row.get::<_, Option<i64>>(15)?.unwrap_or(0),
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// Set the project's north-star context (original request + plan summary).
    /// Auto-creates the project if it does not exist yet.
    pub fn set_project_context(
        &self,
        path: &str,
        original_request: &str,
        plan_summary: &str,
    ) -> Result<Project> {
        let project = self.ensure_project(path, None)?;
        self.set_project_context_by_id(project.id, original_request, plan_summary)
    }

    /// Project-id variant of `set_project_context`.
    pub fn set_project_context_by_id(
        &self,
        project_id: i64,
        original_request: &str,
        plan_summary: &str,
    ) -> Result<Project> {
        self.conn.execute(
            "UPDATE projects SET original_request = ?1, plan_summary = ?2 WHERE id = ?3",
            params![original_request, plan_summary, project_id],
        )?;
        self.find_project(&project_id.to_string())
    }

    /// Record where the last AI stopped: the actor, its session id (so the user
    /// can resume that exact session), a short note, and the flagged pickup task.
    pub fn set_handoff(
        &self,
        path: &str,
        actor: &str,
        session_id: &str,
        note: &str,
        current_task_id: Option<i64>,
    ) -> Result<Project> {
        let project = self.ensure_project(path, None)?;
        self.set_handoff_by_id(project.id, actor, session_id, note, current_task_id)
    }

    /// Project-id variant of `set_handoff`.
    pub fn set_handoff_by_id(
        &self,
        project_id: i64,
        actor: &str,
        session_id: &str,
        note: &str,
        current_task_id: Option<i64>,
    ) -> Result<Project> {
        let ts = now();
        self.conn.execute(
            "UPDATE projects SET last_actor = ?1, last_session_id = ?2, handoff_note = ?3, \
             current_task_id = ?4, handoff_updated_at = ?5 WHERE id = ?6",
            params![actor, session_id, note, current_task_id, ts, project_id],
        )?;
        if let Some(task_id) = current_task_id {
            // Record on the task timeline so the handoff shows up in its activity.
            let _ = self.conn.execute(
                "INSERT INTO task_events (task_id, actor, kind, detail, created_at)
                 VALUES (?1, ?2, 'handoff', ?3, ?4)",
                params![task_id, actor, note, ts],
            );
        }
        self.find_project(&project_id.to_string())
    }

    /// Create a new request-project for the given folder. Multiple projects may
    /// share the same path, each with its own context and task list.
    pub fn create_project(&self, path: &str, name: &str, description: &str) -> Result<Project> {
        let root = resolve_project_root(path);
        let created_at = now();
        self.conn.execute(
            "INSERT INTO projects (name, path, created_at, original_request) VALUES (?1, ?2, ?3, ?4)",
            params![name, root, created_at, description],
        )?;
        let id = self.conn.last_insert_rowid();
        self.find_project(&id.to_string())
    }

    /// Delete a project and all its tasks, comments, and history (cascades via FK).
    pub fn delete_project(&self, id: i64) -> Result<()> {
        let rows = self.conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        if rows == 0 {
            Err(Error::ProjectNotFound(id.to_string()))
        } else {
            Ok(())
        }
    }

    /// Assemble everything a fresh AI needs to pick up work on a project.
    pub fn get_briefing(&self, path: &str) -> Result<Briefing> {
        let project = self
            .find_project_by_path(path)?
            .ok_or_else(|| Error::ProjectNotFound(path.to_string()))?;
        self.get_briefing_by_id(project.id)
    }

    /// Project-id variant of `get_briefing`.
    pub fn get_briefing_by_id(&self, project_id: i64) -> Result<Briefing> {
        let project = self.find_project(&project_id.to_string())?;
        let tasks = self.list_tasks(&TaskFilter {
            project_id: Some(project.id),
            ..Default::default()
        })?;
        let resume_task = resolve_resume_task(&project, &tasks);
        Ok(Briefing {
            project,
            resume_task,
            tasks,
        })
    }
}

/// The task to resume: the flagged `current_task_id` if it exists and is not
/// done, otherwise the first `in_progress`/`open` task by order (the fallback
/// that relies on plans being broken into small ordered tasks).
fn resolve_resume_task(project: &Project, tasks: &[Task]) -> Option<Task> {
    if let Some(flagged) = project.current_task_id {
        if let Some(task) = tasks.iter().find(|t| t.id == flagged) {
            if task.status != Status::Done {
                return Some(task.clone());
            }
        }
    }
    // `tasks` is ordered by priority then position (see list_tasks). Prefer an
    // in-progress task, then the first open one.
    tasks
        .iter()
        .find(|t| t.status == Status::InProgress)
        .or_else(|| tasks.iter().find(|t| t.status == Status::Open))
        .cloned()
}

fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        created_at: row.get(3)?,
        original_request: row.get(4)?,
        plan_summary: row.get(5)?,
        last_actor: row.get(6)?,
        last_session_id: row.get(7)?,
        handoff_note: row.get(8)?,
        current_task_id: row.get(9)?,
        handoff_updated_at: row.get(10)?,
    })
}
