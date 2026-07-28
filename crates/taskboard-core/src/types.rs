use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use crate::error::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Open,
    Waiting,
    InProgress,
    Review,
    Done,
}

impl Status {
    pub const ALL: [Status; 5] = [
        Status::Open,
        Status::Waiting,
        Status::InProgress,
        Status::Review,
        Status::Done,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            Status::Open => "open",
            Status::Waiting => "waiting",
            Status::InProgress => "in_progress",
            Status::Review => "review",
            Status::Done => "done",
        }
    }
}

impl FromStr for Status {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Error> {
        match s {
            "open" => Ok(Status::Open),
            "waiting" => Ok(Status::Waiting),
            "in_progress" => Ok(Status::InProgress),
            "review" => Ok(Status::Review),
            "done" => Ok(Status::Done),
            other => Err(Error::InvalidStatus(other.to_string())),
        }
    }
}

impl fmt::Display for Status {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low,
    Normal,
    High,
    Urgent,
}

impl Priority {
    pub fn as_str(&self) -> &'static str {
        match self {
            Priority::Low => "low",
            Priority::Normal => "normal",
            Priority::High => "high",
            Priority::Urgent => "urgent",
        }
    }
}

impl FromStr for Priority {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Error> {
        match s {
            "low" => Ok(Priority::Low),
            "normal" => Ok(Priority::Normal),
            "high" => Ok(Priority::High),
            "urgent" => Ok(Priority::Urgent),
            other => Err(Error::InvalidPriority(other.to_string())),
        }
    }
}

impl fmt::Display for Priority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Task,
    Bug,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Task => "task",
            Kind::Bug => "bug",
        }
    }
}

impl FromStr for Kind {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Error> {
        match s {
            "task" => Ok(Kind::Task),
            "bug" => Ok(Kind::Bug),
            other => Err(Error::InvalidKind(other.to_string())),
        }
    }
}

impl fmt::Display for Kind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub created_at: String,
    /// The user's verbatim original request — the project's north-star context.
    pub original_request: String,
    /// Short summary of the approved plan / agreed approach.
    pub plan_summary: String,
    /// Who worked last (claude-code / codex / opencode / me).
    pub last_actor: String,
    /// The last AI's session id, so the user can resume that exact session.
    pub last_session_id: String,
    /// Short "stopped here / next do X" handoff note.
    pub handoff_note: String,
    /// The flagged pickup task: where the last AI stopped.
    pub current_task_id: Option<i64>,
    /// When the handoff state last changed.
    pub handoff_updated_at: Option<String>,
    /// TargetProcess user story this project's tasks are created under.
    pub tp_user_story_id: Option<i64>,
    /// Cached user story name, so the UI can label the link without a round trip.
    pub tp_user_story_name: String,
    /// TargetProcess project id owning the story — required when creating entities.
    pub tp_project_id: Option<i64>,
    /// TargetProcess process id — required to resolve workflow states.
    pub tp_process_id: Option<i64>,
    /// Whether changes to this project are pushed to TargetProcess.
    pub tp_sync_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    #[serde(flatten)]
    pub project: Project,
    pub open: i64,
    pub waiting: i64,
    pub in_progress: i64,
    pub review: i64,
    pub done: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub project_id: i64,
    pub project_name: String,
    pub title: String,
    pub description: String,
    pub status: Status,
    pub kind: Kind,
    pub assignee: String,
    pub priority: Priority,
    pub position: f64,
    pub created_at: String,
    pub updated_at: String,
    /// Id of the mirrored TargetProcess entity, once it has been created.
    pub tp_entity_id: Option<i64>,
    /// TargetProcess entity type: `Task` or `Bug`.
    pub tp_entity_type: String,
    /// Simulated human effort in points, where 1 point = 1 hour. Logged to
    /// TargetProcess as `Spent` when the task is completed.
    pub estimate_points: f64,
    /// `none` | `pending` | `synced` | `error`.
    pub tp_sync_state: String,
    /// Last TargetProcess error for this task, if `tp_sync_state` is `error`.
    pub tp_sync_error: String,
    /// Hours already logged to TargetProcess. Guards against double-logging.
    pub tp_time_logged: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: i64,
    pub task_id: i64,
    pub author: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: i64,
    pub task_id: i64,
    pub actor: String,
    pub kind: String,
    pub detail: String,
    pub created_at: String,
}

/// Minimal reference to a related task (dependency edge endpoint).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRef {
    pub id: i64,
    pub title: String,
    pub status: Status,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskDetail {
    #[serde(flatten)]
    pub task: Task,
    pub depends_on: Vec<TaskRef>,
    pub blocks: Vec<TaskRef>,
    pub comments: Vec<Comment>,
    pub events: Vec<Event>,
}

/// Everything a fresh AI needs to pick up work on a project: the north-star
/// context, where the last AI stopped, the task to resume, and the full
/// ordered task list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Briefing {
    pub project: Project,
    /// The task to resume: the flagged `current_task_id` if not done, else the
    /// first `open`/`in_progress` task by order. `None` if nothing is pending.
    pub resume_task: Option<Task>,
    /// All tasks for the project, ordered by position.
    pub tasks: Vec<Task>,
}

/// Input for creating a task.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NewTask {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub assignee: String,
    #[serde(default)]
    pub kind: Option<Kind>,
    #[serde(default)]
    pub priority: Option<Priority>,
    /// IDs of tasks this task depends on.
    #[serde(default)]
    pub depends_on: Vec<i64>,
    /// Simulated human effort in points (1 point = 1 hour, 0.5 = 30 min).
    #[serde(default)]
    pub estimate_points: Option<f64>,
}

/// Filter for listing tasks.
#[derive(Debug, Clone, Default)]
pub struct TaskFilter {
    pub project_id: Option<i64>,
    pub status: Option<Status>,
    pub assignee: Option<String>,
}

/// Result of a status change: the updated task plus any tasks that were
/// auto-promoted from `waiting` to `open` because their dependencies finished.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusChange {
    pub task: Task,
    pub promoted: Vec<Task>,
}
