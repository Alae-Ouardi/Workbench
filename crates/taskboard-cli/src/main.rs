mod mcp;
mod output;

use std::str::FromStr;

use anyhow::Result;
use clap::{Parser, Subcommand};
use taskboard_core::{Db, Kind, NewTask, Priority, Project, Status, TaskFilter, TaskUpdate};

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
    /// Create a project (request) for a folder.
    CreateProject {
        /// Project directory (default: current directory; resolved to git root).
        #[arg(long, short)]
        path: Option<String>,
        /// Display name (default: folder basename).
        #[arg(long, short)]
        name: Option<String>,
        /// The AI brief / original request for this project.
        #[arg(long, short)]
        description: Option<String>,
    },
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
        /// Simulated human effort in points (1 = 1 hour, 0.5 = 30 min).
        #[arg(long)]
        estimate: Option<f64>,
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
        /// Simulated human effort in points (1 = 1 hour, 0.5 = 30 min).
        #[arg(long)]
        estimate: Option<f64>,
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
    /// TargetProcess integration: status, manual sync, project linking.
    Tp {
        #[command(subcommand)]
        command: TpCommand,
    },
    /// Run the MCP server over stdio (used by Claude Code / Codex / OpenCode).
    Mcp,
}

#[derive(Subcommand)]
enum TpCommand {
    /// Show the connection settings and how much work is queued.
    Status,
    /// Push everything queued to TargetProcess now (the app does this every 15s).
    Sync,
    /// Link a project to a TargetProcess user story.
    Link {
        /// User story id, or a pasted TargetProcess entity URL.
        user_story: String,
        /// Project id, path, or name (default: current directory).
        #[arg(long, short)]
        project: Option<String>,
        /// Don't mirror the tasks that already exist in this project.
        #[arg(long)]
        no_backfill: bool,
    },
    /// Re-send existing tasks so TargetProcess picks up their current title,
    /// description, team and sprint.
    Repush {
        /// Project id, path, or name (default: current directory).
        #[arg(long, short)]
        project: Option<String>,
    },
    /// Stop syncing a project. TargetProcess entities are left alone.
    Unlink {
        #[arg(long, short)]
        project: Option<String>,
    },
    /// List queued operations, with the error on any that failed.
    Queue,
    /// Make every failed operation due again (e.g. after fixing the token).
    Retry,
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
        Command::CreateProject {
            path,
            name,
            description,
        } => {
            let path = path.unwrap_or_else(cwd);
            let name = name.unwrap_or_else(|| {
                std::path::Path::new(&path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone())
            });
            let description = description.unwrap_or_default();
            let p = db.create_project(&path, &name, &description)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&p)?);
            } else {
                println!("Created project '{}' (#{}) at {}", p.name, p.id, p.path);
            }
        }
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
            estimate,
        } => {
            let project = resolve_project(&db, project)?;
            let new = NewTask {
                title,
                description,
                assignee,
                kind: bug.then_some(Kind::Bug),
                priority: priority.as_deref().map(Priority::from_str).transpose()?,
                depends_on,
                estimate_points: estimate,
            };
            let task = db.create_task(project.id, &new, &actor)?;
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
                println!(
                    "#{} dependencies set ({} deps), status: {}",
                    id,
                    depends_on.len(),
                    task.status
                );
            }
        }
        Command::Update {
            id,
            title,
            description,
            assignee,
            priority,
            estimate,
        } => {
            let update = TaskUpdate {
                title,
                description,
                assignee,
                priority: priority.as_deref().map(Priority::from_str).transpose()?,
                position: None,
                estimate_points: estimate,
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
                println!(
                    "Deleted project '{}' (#{}) and all its tasks.",
                    p.name, p.id
                );
            }
        }
        Command::Briefing { project } => {
            let project = resolve_project(&db, project)?;
            let briefing = db.get_briefing_by_id(project.id)?;
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
            let project = resolve_project(&db, project)?;
            let p = db.set_project_context_by_id(project.id, &request, &plan)?;
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
            let project = resolve_project(&db, project)?;
            let p = db.set_handoff_by_id(project.id, &actor, &session, &note, task)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&p)?);
            } else {
                match p.current_task_id {
                    Some(id) => println!("Handoff saved for '{}' (stopped at #{id}).", p.name),
                    None => println!("Handoff saved for '{}'.", p.name),
                }
            }
        }
        Command::Tp { command } => run_tp(&db, command, json)?,
        Command::Mcp => unreachable!(),
    }
    Ok(())
}

fn run_tp(db: &Db, command: TpCommand, json: bool) -> Result<()> {
    use taskboard_core::TpSettings;

    match command {
        TpCommand::Status => {
            let settings = TpSettings::load();
            let (pending, failed) = db.count_tp_queue()?;
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "configured": settings.has_valid_url(),
                        "enabled": settings.enabled,
                        "base_url": settings.normalized_base_url(),
                        "user": settings.cached_user_name,
                        "pending": pending,
                        "failed": failed,
                    })
                );
            } else {
                let url = settings.normalized_base_url();
                println!(
                    "TargetProcess: {}",
                    if url.is_empty() {
                        "not configured"
                    } else {
                        url
                    }
                );
                println!(
                    "Sync:          {}",
                    if settings.enabled { "on" } else { "off" }
                );
                println!("Done state:    {}", settings.done_state_name);
                if !settings.cached_user_name.is_empty() {
                    println!("Token owner:   {}", settings.cached_user_name);
                }
                println!("Queued:        {pending} pending, {failed} failed");
            }
        }
        TpCommand::Sync => {
            let report = db.drain_tp_queue()?;
            if json {
                println!("{}", serde_json::to_string_pretty(&report)?);
            } else {
                println!(
                    "Synced {} of {} operation(s); {} failed, {} dropped, {} still queued.",
                    report.succeeded,
                    report.processed,
                    report.failed,
                    report.dropped,
                    report.pending
                );
                if let Some(error) = report.error {
                    println!("First error: {error}");
                }
            }
        }
        TpCommand::Link {
            user_story,
            project,
            no_backfill,
        } => {
            let project = resolve_project(db, project)?;
            let story_id = taskboard_core::tp::client::parse_entity_id(&user_story)
                .ok_or_else(|| anyhow::anyhow!("'{user_story}' is not a user story id or URL"))?;
            let linked = db.link_tp_project(project.id, story_id)?;
            let queued = if no_backfill {
                0
            } else {
                db.backfill_tp_project(project.id)?
            };
            if json {
                println!(
                    "{}",
                    serde_json::json!({ "project": linked, "queued_operations": queued })
                );
            } else {
                println!(
                    "Linked '{}' to user story #{} ({}).",
                    linked.name, story_id, linked.tp_user_story_name
                );
                if queued > 0 {
                    println!(
                        "Queued {queued} operation(s) — run `taskboard tp sync` to push them."
                    );
                }
            }
        }
        TpCommand::Repush { project } => {
            let project = resolve_project(db, project)?;
            let queued = db.repush_tp_project(project.id)?;
            if json {
                println!(
                    "{}",
                    serde_json::json!({ "project": project.name, "queued_operations": queued })
                );
            } else if queued == 0 {
                println!("'{}' has no mirrored tasks to re-push.", project.name);
            } else {
                println!(
                    "Queued {queued} update(s) for '{}' — run `taskboard tp sync` to push them.",
                    project.name
                );
            }
        }
        TpCommand::Unlink { project } => {
            let project = resolve_project(db, project)?;
            let unlinked = db.unlink_tp_project(project.id)?;
            println!("Unlinked '{}' from TargetProcess.", unlinked.name);
        }
        TpCommand::Queue => {
            let items = db.list_tp_queue()?;
            if json {
                println!("{}", serde_json::to_string_pretty(&items)?);
            } else if items.is_empty() {
                println!("Nothing queued.");
            } else {
                for item in items {
                    let task = if item.task_title.is_empty() {
                        String::new()
                    } else {
                        format!(" — {}", item.task_title)
                    };
                    println!(
                        "#{} {}{}{}",
                        item.id,
                        item.label,
                        task,
                        if item.exhausted {
                            "  [needs retry]"
                        } else {
                            ""
                        }
                    );
                    if !item.last_error.is_empty() {
                        println!("     attempt {}: {}", item.attempts, item.last_error);
                    }
                }
            }
        }
        TpCommand::Retry => {
            let n = db.retry_all_tp_ops()?;
            println!("Reset {n} failed operation(s); run `taskboard tp sync` to retry.");
        }
    }
    Ok(())
}

fn cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".to_string())
}

/// Resolve an explicit project key, or fall back to the cwd and require
/// disambiguation when multiple projects share the same folder.
fn resolve_project(db: &Db, project_arg: Option<String>) -> Result<Project> {
    match project_arg {
        Some(key) => Ok(db.find_project(&key)?),
        None => {
            let matches = db.find_projects_by_path(&cwd())?;
            match matches.len() {
                0 => anyhow::bail!(
                    "No project found for {}. Create one with: taskboard create-project --path <dir> --name <name>",
                    cwd()
                ),
                1 => Ok(matches.into_iter().next().unwrap()),
                _ => {
                    eprintln!("Multiple projects match {}:", cwd());
                    for p in &matches {
                        eprintln!("  #{} {}", p.id, p.name);
                    }
                    anyhow::bail!("Specify which project with --project <id or name>")
                }
            }
        }
    }
}
