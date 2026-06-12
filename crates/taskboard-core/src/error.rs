use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("task #{0} not found")]
    TaskNotFound(i64),

    #[error("project not found: {0}")]
    ProjectNotFound(String),

    #[error("invalid status '{0}' (expected one of: open, waiting, in_progress, review, done)")]
    InvalidStatus(String),

    #[error("invalid priority '{0}' (expected one of: low, normal, high, urgent)")]
    InvalidPriority(String),

    #[error("invalid kind '{0}' (expected 'task' or 'bug')")]
    InvalidKind(String),

    #[error("dependency would create a cycle: task #{task_id} <-> #{depends_on_id}")]
    DependencyCycle { task_id: i64, depends_on_id: i64 },

    #[error("task cannot depend on itself")]
    SelfDependency,

    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
