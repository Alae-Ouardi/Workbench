//! TargetProcess integration.
//!
//! A TaskBoard project can be linked to a TargetProcess user story. From then
//! on its tasks are mirrored as TargetProcess entities, completing a task moves
//! that entity to the workflow's done state, and the task's effort estimate is
//! logged as a time entry.
//!
//! The integration lives in `taskboard-core` rather than in the app because
//! tasks are created and completed from several processes — the Tauri app, the
//! MCP server, the CLI — and all of them must queue the same work. Pushing is
//! split from queueing:
//!
//! * [`queue`] is written synchronously by whoever changed the board, inside
//!   the same transaction, so local work never waits on the network;
//! * [`sync`] drains that queue — from the app's background worker, or from
//!   `taskboard tp sync` when the app is not running.

pub mod client;
pub mod config;
pub mod queue;
pub mod sync;

pub use client::{TpEntityState, TpUser, TpUserStory};
pub use config::TpSettings;
pub use queue::{SyncQueueItem, SyncReport};
