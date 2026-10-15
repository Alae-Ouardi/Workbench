//! The outbound TargetProcess operation queue.
//!
//! Board changes never wait on the network: whichever process makes a change
//! (the app, the MCP server, the CLI) appends a row here inside the same
//! transaction, and a worker drains it later. That keeps an agent's
//! `create_tasks` / `update_task_status` calls fast and offline-safe.

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::db::{now, Db};
use crate::error::Result;
use crate::types::Status;

/// Give up automatic retries after this many attempts and park the row for a
/// manual retry from the settings UI.
pub const MAX_ATTEMPTS: i64 = 8;
const BASE_BACKOFF_SECS: i64 = 60;
const MAX_BACKOFF_SECS: i64 = 3600;

/// What a queued row asks the worker to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncOp {
    /// Mirror a TaskBoard task into TargetProcess.
    CreateEntity,
    /// Push the task's title, description, team and sprint onto the entity that
    /// already mirrors it.
    UpdateEntity,
    /// Move the mirrored entity to the state mapped from a TaskBoard status.
    SetState,
    /// Log the task's estimate as a time entry.
    LogTime,
}

impl SyncOp {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncOp::CreateEntity => "create_entity",
            SyncOp::UpdateEntity => "update_entity",
            SyncOp::SetState => "set_state",
            SyncOp::LogTime => "log_time",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "create_entity" => Some(SyncOp::CreateEntity),
            "update_entity" => Some(SyncOp::UpdateEntity),
            "set_state" => Some(SyncOp::SetState),
            "log_time" => Some(SyncOp::LogTime),
            _ => None,
        }
    }

    /// Human-readable label for the settings UI.
    pub fn label(&self) -> &'static str {
        match self {
            SyncOp::CreateEntity => "Create in TargetProcess",
            SyncOp::UpdateEntity => "Update title, description and sprint",
            SyncOp::SetState => "Update state",
            SyncOp::LogTime => "Log time",
        }
    }
}

/// One queued operation, as shown in the settings UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncQueueItem {
    pub id: i64,
    pub kind: String,
    pub label: String,
    pub project_id: i64,
    pub task_id: Option<i64>,
    /// Title of the task the row is about, for display.
    pub task_title: String,
    pub attempts: i64,
    pub last_error: String,
    pub next_attempt_at: String,
    pub created_at: String,
    /// True once automatic retries are exhausted; only a manual retry moves it.
    pub exhausted: bool,
}

/// Outcome of draining the queue.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SyncReport {
    pub processed: usize,
    pub succeeded: usize,
    pub failed: usize,
    /// Rows skipped because their task or project no longer needs syncing.
    pub dropped: usize,
    /// Rows still waiting, including those parked for a manual retry.
    pub pending: usize,
    /// First error encountered, for surfacing in the UI.
    pub error: Option<String>,
}

/// A claimed row, ready to execute.
#[derive(Debug, Clone)]
pub(crate) struct ClaimedItem {
    pub id: i64,
    pub op: SyncOp,
    pub project_id: i64,
    pub task_id: Option<i64>,
    pub payload: serde_json::Value,
    pub attempts: i64,
}

impl Db {
    /// Queue an operation. Called from inside the caller's transaction.
    pub(crate) fn enqueue_tp_op(
        &self,
        op: SyncOp,
        project_id: i64,
        task_id: Option<i64>,
        payload: &serde_json::Value,
    ) -> Result<i64> {
        let ts = now();
        self.conn.execute(
            "INSERT INTO tp_sync_queue (kind, project_id, task_id, payload, next_attempt_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![op.as_str(), project_id, task_id, payload.to_string(), ts],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Queue an operation and flag the task as pending, so the UI can show it.
    pub(crate) fn enqueue_task_op(
        &self,
        op: SyncOp,
        project_id: i64,
        task_id: i64,
        payload: &serde_json::Value,
    ) -> Result<i64> {
        let id = self.enqueue_tp_op(op, project_id, Some(task_id), payload)?;
        self.conn.execute(
            "UPDATE tasks SET tp_sync_state = 'pending', tp_sync_error = '' WHERE id = ?1",
            params![task_id],
        )?;
        Ok(id)
    }

    /// Claim rows that are due, oldest first.
    ///
    /// `id` order matters: a task's `create_entity` is always queued before its
    /// `set_state` / `log_time`, so processing in insertion order guarantees the
    /// entity exists before we try to update it.
    pub(crate) fn claim_due_tp_ops(&self, limit: usize) -> Result<Vec<ClaimedItem>> {
        let ts = now();
        let mut stmt = self.conn.prepare(
            "SELECT id, kind, project_id, task_id, payload, attempts
             FROM tp_sync_queue
             WHERE next_attempt_at <= ?1 AND attempts < ?2
             ORDER BY id
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![ts, MAX_ATTEMPTS, limit as i64], |row| {
            let kind: String = row.get(1)?;
            let payload: String = row.get(4)?;
            Ok((
                row.get::<_, i64>(0)?,
                kind,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<i64>>(3)?,
                payload,
                row.get::<_, i64>(5)?,
            ))
        })?;
        let mut items = Vec::new();
        for row in rows {
            let (id, kind, project_id, task_id, payload, attempts) = row?;
            // A row with an unknown kind can never run; drop it rather than
            // letting it block the queue forever.
            let Some(op) = SyncOp::from_str(&kind) else {
                self.delete_tp_op(id)?;
                continue;
            };
            items.push(ClaimedItem {
                id,
                op,
                project_id,
                task_id,
                payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
                attempts,
            });
        }
        Ok(items)
    }

    pub(crate) fn delete_tp_op(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM tp_sync_queue WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Mark a row done: remove it, and settle the task's sync state.
    pub(crate) fn complete_tp_op(&self, item: &ClaimedItem) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        self.delete_tp_op(item.id)?;
        if let Some(task_id) = item.task_id {
            // Only clear the badge once nothing else is queued for this task.
            let remaining: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM tp_sync_queue WHERE task_id = ?1",
                params![task_id],
                |row| row.get(0),
            )?;
            if remaining == 0 {
                self.conn.execute(
                    "UPDATE tasks SET tp_sync_state = 'synced', tp_sync_error = '' WHERE id = ?1",
                    params![task_id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Record a failure and schedule the next attempt with exponential backoff.
    /// Returns true when automatic retries are now exhausted.
    pub(crate) fn fail_tp_op(&self, item: &ClaimedItem, error: &str) -> Result<bool> {
        let tx = self.conn.unchecked_transaction()?;
        let attempts = item.attempts + 1;
        let delay = backoff_secs(attempts);
        let next = (chrono::Utc::now() + chrono::Duration::seconds(delay))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let message = clip_error(error);
        self.conn.execute(
            "UPDATE tp_sync_queue SET attempts = ?1, last_error = ?2, next_attempt_at = ?3
             WHERE id = ?4",
            params![attempts, message, next, item.id],
        )?;
        let exhausted = attempts >= MAX_ATTEMPTS;
        if let Some(task_id) = item.task_id {
            // Surface the message immediately; the badge distinguishes a retry
            // still to come from one that needs a human.
            self.conn.execute(
                "UPDATE tasks SET tp_sync_state = ?1, tp_sync_error = ?2 WHERE id = ?3",
                params![
                    if exhausted { "error" } else { "pending" },
                    message,
                    task_id
                ],
            )?;
        }
        tx.commit()?;
        Ok(exhausted)
    }

    /// Make a row due immediately and reset its attempt count — the manual
    /// "Retry" action, used after fixing a token or a workflow.
    pub fn retry_tp_op(&self, id: i64) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let ts = now();
        self.conn.execute(
            "UPDATE tp_sync_queue SET attempts = 0, last_error = '', next_attempt_at = ?1
             WHERE id = ?2",
            params![ts, id],
        )?;
        if let Some(task_id) = self
            .conn
            .query_row(
                "SELECT task_id FROM tp_sync_queue WHERE id = ?1",
                params![id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten()
        {
            self.conn.execute(
                "UPDATE tasks SET tp_sync_state = 'pending', tp_sync_error = '' WHERE id = ?1",
                params![task_id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Reset every parked row — the "Retry all" action.
    pub fn retry_all_tp_ops(&self) -> Result<usize> {
        let tx = self.conn.unchecked_transaction()?;
        let ts = now();
        let n = self.conn.execute(
            "UPDATE tp_sync_queue SET attempts = 0, last_error = '', next_attempt_at = ?1
             WHERE attempts > 0",
            params![ts],
        )?;
        self.conn.execute(
            "UPDATE tasks SET tp_sync_state = 'pending', tp_sync_error = ''
             WHERE tp_sync_state = 'error'",
            [],
        )?;
        tx.commit()?;
        Ok(n)
    }

    /// Drop a queued operation the user has given up on.
    pub fn dismiss_tp_op(&self, id: i64) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        let task_id: Option<i64> = self
            .conn
            .query_row(
                "SELECT task_id FROM tp_sync_queue WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        self.delete_tp_op(id)?;
        if let Some(task_id) = task_id {
            let remaining: i64 = self.conn.query_row(
                "SELECT COUNT(*) FROM tp_sync_queue WHERE task_id = ?1",
                params![task_id],
                |row| row.get(0),
            )?;
            if remaining == 0 {
                // Nothing outstanding, and we never confirmed a push: back to
                // 'none' unless the entity already exists in TargetProcess.
                self.conn.execute(
                    "UPDATE tasks
                     SET tp_sync_state = CASE WHEN tp_entity_id IS NULL THEN 'none' ELSE 'synced' END,
                         tp_sync_error = ''
                     WHERE id = ?1",
                    params![task_id],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Everything currently queued, oldest first.
    pub fn list_tp_queue(&self) -> Result<Vec<SyncQueueItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT q.id, q.kind, q.project_id, q.task_id, COALESCE(t.title, ''),
                    q.attempts, q.last_error, q.next_attempt_at, q.created_at
             FROM tp_sync_queue q
             LEFT JOIN tasks t ON t.id = q.task_id
             ORDER BY q.id",
        )?;
        let rows = stmt.query_map([], |row| {
            let kind: String = row.get(1)?;
            let attempts: i64 = row.get(5)?;
            Ok(SyncQueueItem {
                id: row.get(0)?,
                label: SyncOp::from_str(&kind)
                    .map(|o| o.label().to_string())
                    .unwrap_or_else(|| kind.clone()),
                kind,
                project_id: row.get(2)?,
                task_id: row.get(3)?,
                task_title: row.get(4)?,
                attempts,
                last_error: row.get(6)?,
                next_attempt_at: row.get(7)?,
                created_at: row.get(8)?,
                exhausted: attempts >= MAX_ATTEMPTS,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn count_tp_queue(&self) -> Result<(i64, i64)> {
        let pending: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tp_sync_queue WHERE attempts < ?1",
            params![MAX_ATTEMPTS],
            |row| row.get(0),
        )?;
        let exhausted: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM tp_sync_queue WHERE attempts >= ?1",
            params![MAX_ATTEMPTS],
            |row| row.get(0),
        )?;
        Ok((pending, exhausted))
    }

    /// Queue everything needed to mirror a project's existing tasks — used when
    /// linking a project that already has work on the board.
    pub fn backfill_tp_project(&self, project_id: i64) -> Result<usize> {
        let project = self.project_by_id(project_id)?;
        let Some(user_story_id) = project.tp_user_story_id else {
            return Err(crate::error::Error::TpNotConfigured(format!(
                "project '{}' is not linked to a user story",
                project.name
            )));
        };
        let tx = self.conn.unchecked_transaction()?;
        let tasks = self.list_tasks(&crate::types::TaskFilter {
            project_id: Some(project_id),
            ..Default::default()
        })?;
        let mut queued = 0;
        for task in tasks {
            if task.tp_entity_id.is_none() {
                self.enqueue_task_op(
                    SyncOp::CreateEntity,
                    project_id,
                    task.id,
                    &serde_json::json!({ "user_story_id": user_story_id }),
                )?;
                queued += 1;
            }
            // Bring already-finished tasks up to date too, so a mid-project
            // link doesn't silently lose their completion and time.
            if task.status == Status::Done {
                queued += self.enqueue_completion_ops(&task, project_id)?;
            }
        }
        tx.commit()?;
        Ok(queued)
    }

    /// The state change and (once only) the time entry for a completed task.
    pub(crate) fn enqueue_completion_ops(
        &self,
        task: &crate::types::Task,
        project_id: i64,
    ) -> Result<usize> {
        let mut queued = 0;
        self.enqueue_task_op(
            SyncOp::SetState,
            project_id,
            task.id,
            &serde_json::json!({ "status": Status::Done.as_str() }),
        )?;
        queued += 1;
        if task.estimate_points > 0.0 && task.tp_time_logged <= 0.0 {
            self.enqueue_task_op(
                SyncOp::LogTime,
                project_id,
                task.id,
                &serde_json::json!({ "hours": task.estimate_points }),
            )?;
            queued += 1;
        }
        Ok(queued)
    }
}

/// Exponential backoff, capped so a long outage still retries hourly.
pub fn backoff_secs(attempts: i64) -> i64 {
    let exponent = (attempts - 1).clamp(0, 16) as u32;
    BASE_BACKOFF_SECS
        .saturating_mul(2i64.saturating_pow(exponent))
        .min(MAX_BACKOFF_SECS)
}

fn clip_error(error: &str) -> String {
    // Never store the access token, whatever produced the error.
    let redacted = crate::tp::redact::redact_token(error);
    let trimmed = redacted.trim();
    if trimmed.chars().count() <= 300 {
        return trimmed.to_string();
    }
    trimmed.chars().take(300).collect::<String>() + "…"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_then_caps_at_an_hour() {
        assert_eq!(backoff_secs(1), 60);
        assert_eq!(backoff_secs(2), 120);
        assert_eq!(backoff_secs(3), 240);
        assert_eq!(backoff_secs(4), 480);
        assert_eq!(backoff_secs(5), 960);
        assert_eq!(backoff_secs(6), 1920);
        // Capped from here on, and never overflows for absurd attempt counts.
        assert_eq!(backoff_secs(7), MAX_BACKOFF_SECS);
        assert_eq!(backoff_secs(MAX_ATTEMPTS), MAX_BACKOFF_SECS);
        assert_eq!(backoff_secs(9999), MAX_BACKOFF_SECS);
        // Defensive: a zero/negative attempt count must not panic.
        assert_eq!(backoff_secs(0), 60);
    }

    #[test]
    fn op_names_round_trip() {
        for op in [SyncOp::CreateEntity, SyncOp::SetState, SyncOp::LogTime] {
            assert_eq!(SyncOp::from_str(op.as_str()), Some(op));
        }
        assert_eq!(SyncOp::from_str("nonsense"), None);
    }

    #[test]
    fn errors_are_clipped_before_storage() {
        assert_eq!(clip_error("  boom  "), "boom");
        assert_eq!(clip_error(&"x".repeat(400)).chars().count(), 301);
    }
}
