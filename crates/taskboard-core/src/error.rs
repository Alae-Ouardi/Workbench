use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("task #{0} not found")]
    TaskNotFound(i64),

    #[error("project not found: {0}")]
    ProjectNotFound(String),

    #[error("ambiguous project '{key}'; multiple matches: {matches:?}")]
    AmbiguousProject { key: String, matches: Vec<String> },

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

    #[error(transparent)]
    Json(#[from] serde_json::Error),

    /// TargetProcess is not configured yet (no URL, no token, or sync disabled).
    #[error("TargetProcess is not configured: {0}")]
    TpNotConfigured(String),

    /// Anything TargetProcess itself rejected, or a transport failure. The
    /// message is surfaced to the user, so it carries the TP response text.
    #[error("TargetProcess: {0}")]
    Tp(String),
}

impl Error {
    /// Whether retrying this operation later could plausibly succeed. Transport
    /// and server-side failures are retried; a rejected payload is not.
    pub fn is_retryable(&self) -> bool {
        match self {
            Error::Tp(msg) => !is_permanent_tp_failure(msg),
            Error::TpNotConfigured(_) => true,
            _ => false,
        }
    }
}

/// A 4xx other than 408/429 means TargetProcess understood us and said no, so
/// replaying the same request will fail the same way.
fn is_permanent_tp_failure(msg: &str) -> bool {
    let Some(rest) = msg.strip_prefix("HTTP ") else {
        return false;
    };
    let code: u16 = rest
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .unwrap_or("")
        .parse()
        .unwrap_or(0);
    (400..500).contains(&code) && code != 408 && code != 429
}

pub type Result<T> = std::result::Result<T, Error>;
