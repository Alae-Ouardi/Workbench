mod mcp;
mod output;

use std::str::FromStr;

use anyhow::Result;
use clap::{Parser, Subcommand};
use taskboard_core::{Db, Kind, NewTask, Priority, Status, TaskFilter, TaskUpdate};

/// TaskBoard: a task dashboard shared between you and your AI coding tools.
///
/// All data lives in a local SQLite database (~/.taskboard/taskboard.db,
/// override with $TASKBOARD_DB) shared with the TaskBoard desktop app and
/// the MCP server.
#[derive(Parser)]
#[command(name = "taskboard", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// Emit machine-readable JSON instead of tables.
    #[arg(long, global = true)]
    json: bool,

    /// Actor name recorded in the activity log (default: $TASKBOARD_ACTOR or "cli").
    #[arg(long, global = true)]
    actor: Option<String>,
}

#[derive(Subcommand)]
enum Command {
    /// List all projects with task counts.
    Projects,
    /// Create a task (or bug, with --bug) in a project.
    Add {
        title: String,
        /// Project directory (default: current directory; resolved to git root).
        #[arg(long, short)]
        project: Option<String>,
        #[arg(long, short, default_value = "")]
        description: String,
        #[arg(long, default_value = "")]
        assignee: String,
        /// low | normal | high | urgent
        #[arg(long)]
        priority: Option<String>,
        /// Mark as a bug instead of a task.
        #[arg(long)]
        bug: bool,
        /// Comma-separated task IDs this task depends on.
        #[arg(long, value_delimiter = ',')]
        depends_on: Vec<i64>,
    },
    /// List tasks, optionally filtered.
    List {
        /// Project id, path, or name.
        #[arg(long, short)]
        project: Option<String>,
        /// open | waiting | in_progress | review | done
        #[arg(long, short)]
        status: Option<String>,
        #[arg(long)]
        assignee: Option<String>,
    },
    /// Show full task detail: description, dependencies, comments, activity.
    Show { id: i64 },
    /// Move a task to a new status (open|waiting|in_progress|review|done).
    Move { id: i64, status: String },
    /// Add a comment / handoff note to a task.
    Comment { id: i64, body: String },
    /// Replace a task's dependencies (comma-separated IDs; empty string clears).
    Deps {
        id: i64,
        #[arg(value_delimiter = ',', num_args = 0..)]
        depends_on: Vec<i64>,
    },
    /// Update task fields.
    Update {
        id: i64,
        #[arg(long)]
        title: Option<String>,
        #[arg(long, short)]
        description: Option<String>,
        #[arg(long)]
        assignee: Option<String>,
        #[arg(long)]
        priority: Option<String>,
    },
    /// Delete a task.
    Delete { id: i64 },
    /// Show the project briefing: original request, plan, handoff state, and the task to resume.
    Briefing {
        /// Project id, path, or name (default: current directory).
        #[arg(long, short)]
        project: Option<String>,
    },
    /// Set the project's north-star context (original request + plan summary).
    Context {
        #[arg(long, short)]
        project: Option<String>,
        /// The user's verbatim original request.
        #[arg(long)]
        request: String,
        /// Short summary of the approved plan.
        #[arg(long, default_value = "")]
        plan: String,
    },
    /// Delete a project and all its tasks permanently (cannot be undone).
    DeleteProject {
        /// Project id, path, or name.
        #[arg(long, short)]
        project: String,
    },
    /// Record where the last AI stopped (handoff state for the next AI).
    Handoff {
        #[arg(long, short)]
        project: Option<String>,
        /// Short "what's done / what's next" note.
        #[arg(long)]
        note: String,
        /// The task you're on / the pickup point.
        #[arg(long)]
        task: Option<i64>,
        /// Your session id, so it can be resumed later.
        #[arg(long, default_value = "")]
        session: String,
    },
    /// Run the MCP server over stdio (used by Claude Code / Codex / OpenCode).
    Mcp,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let actor = cli
        .actor
        .clone()
        .or_else(|| std::env::var("TASKBOARD_ACTOR").ok())
        .unwrap_or_else(|| "cli".to_string());

    if matches!(cli.command, Command::Mcp) {
        return mcp::serve();
    }

    let db = Db::open_default()?;
    let json = cli.json;

    match cli.command {
        Command::Projects => {
            let projects = db.list_projects()?;
            if json {
                println!("{}", serde_json::to_string_pretty(&projects)?);
            } else {
                output::print_projects(&projects);
            }
        }
        Command::Add {
            title,
            project,
            description,
            assignee,
            priority,
            bug,
            depends_on,
        } => {
            let project = project.unwrap_or_else(cwd);
            let new = NewTask {
                title,
                description,
                assignee,
                kind: bug.then_some(Kind::Bug),
                priority: priority.as_deref().map(Priority::from_str).transpose()?,
                depends_on,
            };
            let task = db.create_task(&project, &new, &actor)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!("Created #{} [{}] {}", task.id, task.status, task.title);
            }
        }
        Command::List {
            project,
            status,
            assignee,
        } => {
            let project_id = match project {
                Some(key) => Some(db.find_project(&key)?.id),
                None => None,
            };
            let filter = TaskFilter {
                project_id,
                status: status.as_deref().map(Status::from_str).transpose()?,
                assignee,
            };
            let tasks = db.list_tasks(&filter)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&tasks)?);
            } else {
                output::print_tasks(&tasks);
            }
        }
        Command::Show { id } => {
            let detail = db.get_task(id)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&detail)?);
            } else {
                output::print_detail(&detail);
            }
        }
        Command::Move { id, status } => {
            let change = db.set_status(id, Status::from_str(&status)?, &actor)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&change)?);
            } else {
                println!("#{} -> {}", change.task.id, change.task.status);
                for p in &change.promoted {
                    println!("auto-promoted #{} [{}] {}", p.id, p.status, p.title);
                }
            }
        }
        Command::Comment { id, body } => {
            let comment = db.add_comment(id, &actor, &body)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&comment)?);
            } else {
                println!("Comment added to #{id}");
            }
        }
        Command::Deps { id, depends_on } => {
            let task = db.set_dependencies(id, &depends_on, &actor)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!("#{} dependencies set ({} deps), status: {}", id, depends_on.len(), task.status);
            }
        }
        Command::Update {
            id,
            title,
            description,
            assignee,
            priority,
        } => {
            let update = TaskUpdate {
                title,
                description,
                assignee,
                priority: priority.as_deref().map(Priority::from_str).transpose()?,
                position: None,
            };
            let task = db.update_task(id, &update, &actor)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!("Updated #{}", task.id);
            }
        }
        Command::Delete { id } => {
            db.delete_task(id)?;
            println!("Deleted #{id}");
        }
        Command::DeleteProject { project } => {
            let p = db.find_project(&project)?;
            db.delete_project(p.id)?;
            if json {
                println!("{}", serde_json::json!({"deleted": p.id, "name": p.name}));
            } else {
                println!("Deleted project '{}' (#{}) and all its tasks.", p.name, p.id);
            }
        }
        Command::Briefing { project } => {
            let path = match project {
                Some(key) => db.find_project(&key)?.path,
                None => cwd(),
            };
            let briefing = db.get_briefing(&path)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&briefing)?);
            } else {
                output::print_briefing(&briefing);
            }
        }
        Command::Context {
            project,
            request,
            plan,
        } => {
            let path = project.unwrap_or_else(cwd);
            let p = db.set_project_context(&path, &request, &plan)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&p)?);
            } else {
                println!("Context set for project '{}'.", p.name);
            }
        }
        Command::Handoff {
            project,
            note,
            task,
            session,
        } => {
            let path = project.unwrap_or_else(cwd);
            let p = db.set_handoff(&path, &actor, &session, &note, task)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&p)?);
            } else {
                match p.current_task_id {
                    Some(id) => println!("Handoff saved for '{}' (stopped at #{id}).", p.name),
                    None => println!("Handoff saved for '{}'.", p.name),
                }
            }
        }
        Command::Mcp => unreachable!(),
    }
    Ok(())
}

fn cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string())
}
