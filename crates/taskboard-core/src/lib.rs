//! taskboard-core: the single source of truth for the TaskBoard SQLite
//! database. The Tauri app, the `taskboard` CLI, and the MCP server all go
//! through this crate, so there is exactly one schema and one set of rules.

mod db;
mod error;
mod projects;
mod tasks;
mod types;

pub use db::Db;
pub use error::{Error, Result};
pub use projects::resolve_project_root;
pub use tasks::TaskUpdate;
pub use types::{
    Briefing, Comment, Event, Kind, NewTask, Priority, Project, ProjectSummary, Status,
    StatusChange, Task, TaskDetail, TaskFilter, TaskRef,
};

#[cfg(test)]
mod tests;
