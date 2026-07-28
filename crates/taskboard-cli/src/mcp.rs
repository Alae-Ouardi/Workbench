//! Minimal MCP (Model Context Protocol) server over stdio.
//!
//! Implements the subset of JSON-RPC 2.0 that MCP clients (Claude Code,
//! Codex, OpenCode) need: initialize, ping, tools/list, tools/call.
//! Messages are newline-delimited JSON on stdin/stdout.

use std::io::{BufRead, Write};
use std::str::FromStr;

use anyhow::Result;
use serde_json::{json, Value};
use taskboard_core::{Db, NewTask, Priority, Status, TaskFilter, TaskUpdate};

const SERVER_NAME: &str = "taskboard";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");
const DEFAULT_PROTOCOL_VERSION: &str = "2025-06-18";

pub fn serve() -> Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                write_msg(
                    &stdout,
                    &json!({"jsonrpc": "2.0", "id": null,
                            "error": {"code": -32700, "message": format!("parse error: {e}")}}),
                )?;
                continue;
            }
        };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let params = msg.get("params").cloned().unwrap_or(Value::Null);

        // Notifications (no id) never get a response.
        let Some(id) = id else { continue };

        let response = match handle(method, &params) {
            Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Err((code, message)) => {
                json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
            }
        };
        write_msg(&stdout, &response)?;
    }
    Ok(())
}

fn write_msg(stdout: &std::io::Stdout, msg: &Value) -> Result<()> {
    let mut lock = stdout.lock();
    serde_json::to_writer(&mut lock, msg)?;
    lock.write_all(b"\n")?;
    lock.flush()?;
    Ok(())
}

fn handle(method: &str, params: &Value) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => {
            let requested = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_PROTOCOL_VERSION);
            Ok(json!({
                "protocolVersion": requested,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": "TaskBoard is a shared kanban board for humans and AI coding agents. \
                    When you plan work, create the planned steps with create_tasks. Move a task to \
                    in_progress before working on it, review when it needs human review, and done when \
                    finished. If you must stop before finishing (e.g. usage limit), add a handoff \
                    comment with add_task_comment describing progress and next steps so another agent \
                    can continue.\n\n\
                    Always set estimate_points on every task you create: how long the task would take a \
                    HUMAN to do, in points where 1 = 1 hour and 0.5 = 30 minutes. A project can be \
                    linked to a TargetProcess user story with link_project_user_story; once it is, your \
                    tasks are mirrored there as TargetProcess entities, finishing a task moves the \
                    entity to Done, and its estimate_points is logged as the time spent. Use \
                    tp_sync_status to confirm your changes reached TargetProcess."
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({"tools": tool_definitions()})),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match call_tool(name, &args) {
                Ok(value) => Ok(json!({
                    "content": [{"type": "text", "text": value.to_string()}]
                })),
                Err(e) => Ok(json!({
                    "content": [{"type": "text", "text": format!("Error: {e}")}],
                    "isError": true
                })),
            }
        }
        "resources/list" => Ok(json!({"resources": []})),
        "prompts/list" => Ok(json!({"prompts": []})),
        other => Err((-32601, format!("method not found: {other}"))),
    }
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "create_project",
            "description": "Create a new request-project for a folder. Each request should be its own project, even if it points to the same folder as an existing project.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute path of the project directory (resolved to git root)."},
                    "name": {"type": "string", "description": "Display name for the project."},
                    "description": {"type": "string", "description": "The AI brief / original request for this project."},
                    "tp_user_story": {"type": "string", "description": "Optional TargetProcess user story id or entity URL to link this project to, so its tasks are mirrored there."}
                },
                "required": ["path", "name"]
            }
        },
        {
            "name": "list_projects",
            "description": "List all projects on the TaskBoard with per-status task counts.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "list_tasks",
            "description": "List tasks on the TaskBoard, optionally filtered by project and/or status. \
                Statuses: open, waiting, in_progress, review, done.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "Project id, path, or name. Usually pass the absolute path of the directory you are working in."},
                    "status": {"type": "string", "enum": ["open", "waiting", "in_progress", "review", "done"]},
                    "assignee": {"type": "string"}
                }
            }
        },
        {
            "name": "get_task",
            "description": "Get full task detail: description, dependencies, comments (including handoff notes from other agents), and activity log. Read this before starting work on a task.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "integer"}},
                "required": ["id"]
            }
        },
        {
            "name": "create_tasks",
            "description": "Create one or more tasks (or bugs) in a project. Use this when you plan a topic: create one task per planned step BEFORE starting execution. depends_on takes task IDs; negative values reference earlier tasks in this same batch (-1 = first task in the batch, -2 = second...). Tasks with unfinished dependencies start as 'waiting' and are auto-promoted to 'open' when their dependencies are done.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "integer", "description": "The project id to create tasks in. Call list_projects if you don't know it."},
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                                "assignee": {"type": "string", "description": "Who will do it, e.g. claude-code, codex, opencode, me."},
                                "kind": {"type": "string", "enum": ["task", "bug"]},
                                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
                                "depends_on": {"type": "array", "items": {"type": "integer"}},
                                "estimate_points": {"type": "number", "description": "How long this task would take a HUMAN to do, in points where 1 = 1 hour (0.5 = 30 min, 2 = 2 hours). Estimate every task: when the project is linked to a TargetProcess user story, this is logged as the time spent once the task is done."}
                            },
                            "required": ["title"]
                        }
                    },
                    "actor": {"type": "string", "description": "Your agent name, e.g. claude-code."}
                },
                "required": ["project_id", "tasks"]
            }
        },
        {
            "name": "update_task_status",
            "description": "Move a task to a new status. Move to 'in_progress' before you start working on it, 'review' when it needs human review, 'done' when finished. Marking a task done auto-promotes waiting tasks whose dependencies are all done (they are returned in the response).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "status": {"type": "string", "enum": ["open", "waiting", "in_progress", "review", "done"]},
                    "actor": {"type": "string", "description": "Your agent name, e.g. claude-code."}
                },
                "required": ["id", "status"]
            }
        },
        {
            "name": "add_task_comment",
            "description": "Add a comment to a task. Use this for handoff notes: if you must stop before finishing (usage limit, blocked), describe what you did, what remains, and any gotchas so another agent (claude-code, codex, opencode) can pick up where you left off.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "author": {"type": "string", "description": "Your agent name."},
                    "body": {"type": "string"}
                },
                "required": ["id", "author", "body"]
            }
        },
        {
            "name": "set_task_dependencies",
            "description": "Replace the set of tasks a task depends on (empty array clears them). The task's status adjusts automatically between open and waiting.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "depends_on": {"type": "array", "items": {"type": "integer"}},
                    "actor": {"type": "string"}
                },
                "required": ["id", "depends_on"]
            }
        },
        {
            "name": "update_task",
            "description": "Update task fields: title, description, assignee, priority, estimate_points.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "assignee": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
                    "estimate_points": {"type": "number", "description": "Human effort in points, where 1 = 1 hour (0.5 = 30 min)."},
                    "actor": {"type": "string"}
                },
                "required": ["id"]
            }
        },
        {
            "name": "link_project_user_story",
            "description": "Link a TaskBoard project to a TargetProcess user story. From then on, tasks created in this project are mirrored as TargetProcess entities under that story, finishing a task moves the entity to the workflow's Done state, and the task's estimate_points is logged there as time spent. Requires the TargetProcess URL and access token to be configured in the app's Settings.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_id": {"type": "integer"},
                    "user_story": {"type": "string", "description": "User story id (e.g. \"12345\") or a pasted TargetProcess URL (e.g. \"https://acme.tpondemand.com/entity/12345\")."},
                    "backfill": {"type": "boolean", "description": "Also mirror the tasks that already exist in this project. Default true."}
                },
                "required": ["project_id", "user_story"]
            }
        },
        {
            "name": "unlink_project_user_story",
            "description": "Stop syncing a project to TargetProcess. Existing TargetProcess entities are left alone and their ids stay on the tasks as links.",
            "inputSchema": {
                "type": "object",
                "properties": {"project_id": {"type": "integer"}},
                "required": ["project_id"]
            }
        },
        {
            "name": "tp_sync_status",
            "description": "Check the TargetProcess integration: whether it is configured, how many operations are queued or failed, and the error on each failed one. Call this if you need to confirm your tasks reached TargetProcess.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "delete_task",
            "description": "Delete a task permanently.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "integer"}},
                "required": ["id"]
            }
        },
        {
            "name": "get_briefing",
            "description": "Call this FIRST whenever you start work on a project. Returns the project's north-star context (the user's original request and the approved plan summary), where the last AI stopped (last actor, session id, handoff note, and the flagged task), the task you should resume on, and the full ordered task list. Read it, then resume at resume_task.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "integer", "description": "The project id. Call list_projects if you don't know it."}
                    },
                    "required": ["project_id"]
                }
            },
            {
                "name": "set_project_context",
            "description": "Save the project's north-star context. Call this right after the user approves a plan, together with create_tasks: store the user's verbatim original request and a short summary of the approved plan. Any AI that picks up later reads this to know the goal and the agreed approach.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "integer", "description": "The project id."},
                        "original_request": {"type": "string", "description": "The user's verbatim original request."},
                        "plan_summary": {"type": "string", "description": "Short summary of the approved plan / agreed approach."}
                    },
                    "required": ["project_id", "original_request", "plan_summary"]
                }
            },
            {
                "name": "delete_project",
            "description": "Delete a project and ALL its tasks, comments, and history permanently. This cannot be undone.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "integer", "description": "The project id."}
                    },
                    "required": ["project_id"]
                }
            },
            {
                "name": "save_handoff",
            "description": "Record where you stopped so the next AI (or a future you) can resume cleanly. Call this after each phase and before you stop — especially when nearing a usage limit. Provide the task you're on (current_task_id), a short note on what's done and what's next, and your session id so the user can resume this exact session later (Claude Code: `claude --resume <id>`; Codex/OpenCode have equivalent session ids).",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "project_id": {"type": "integer", "description": "The project id."},
                        "actor": {"type": "string", "description": "Your agent name, e.g. claude-code."},
                        "session_id": {"type": "string", "description": "Your current session id, so the user can resume this exact session."},
                        "note": {"type": "string", "description": "Short 'what's done / what's next' handoff note."},
                        "current_task_id": {"type": "integer", "description": "The task you are on / the pickup point for the next AI."}
                    },
                    "required": ["project_id", "note"]
                }
            }
    ])
}

fn call_tool(name: &str, args: &Value) -> anyhow::Result<Value> {
    let db = Db::open_default()?;
    let actor = args
        .get("actor")
        .and_then(Value::as_str)
        .unwrap_or("ai")
        .to_string();

    match name {
        "create_project" => {
            let path = require_str(args, "path")?;
            let name = require_str(args, "name")?;
            let description = args
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("");
            let project = db.create_project(path, name, description)?;
            // Linking is best-effort: a TargetProcess hiccup must not lose the
            // project the caller just asked for. The failure is reported back.
            match args.get("tp_user_story").and_then(Value::as_str) {
                Some(story) if !story.trim().is_empty() => {
                    match link_user_story(&db, project.id, story) {
                        Ok(linked) => Ok(serde_json::to_value(linked)?),
                        Err(e) => Ok(json!({
                            "project": project,
                            "tp_link_error": e.to_string(),
                        })),
                    }
                }
                _ => Ok(serde_json::to_value(project)?),
            }
        }
        "link_project_user_story" => {
            let project_id = require_i64(args, "project_id")?;
            let story = require_str(args, "user_story")?;
            let project = link_user_story(&db, project_id, story)?;
            let backfill = args
                .get("backfill")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let queued = if backfill {
                db.backfill_tp_project(project_id)?
            } else {
                0
            };
            Ok(json!({
                "project": project,
                "queued_operations": queued,
                "note": "Queued operations are pushed by the TaskBoard app within ~15s, \
                         or immediately with `taskboard tp sync`.",
            }))
        }
        "unlink_project_user_story" => {
            let project_id = require_i64(args, "project_id")?;
            Ok(serde_json::to_value(db.unlink_tp_project(project_id)?)?)
        }
        "tp_sync_status" => {
            let settings = taskboard_core::TpSettings::load();
            let (pending, failed) = db.count_tp_queue()?;
            Ok(json!({
                "configured": settings.has_valid_url(),
                "enabled": settings.enabled,
                "base_url": settings.normalized_base_url(),
                "pending": pending,
                "failed": failed,
                "queue": db.list_tp_queue()?,
            }))
        }
        "list_projects" => Ok(serde_json::to_value(db.list_projects()?)?),
        "list_tasks" => {
            let project_id = match args.get("project").and_then(Value::as_str) {
                Some(key) if !key.is_empty() => Some(db.find_project(key)?.id),
                _ => None,
            };
            let filter = TaskFilter {
                project_id,
                status: opt_parse::<Status>(args, "status")?,
                assignee: args
                    .get("assignee")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            };
            Ok(serde_json::to_value(db.list_tasks(&filter)?)?)
        }
        "get_task" => Ok(serde_json::to_value(db.get_task(require_id(args)?)?)?),
        "create_tasks" => {
            let project_id = args
                .get("project_id")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: project_id"))?;
            let raw_tasks = args
                .get("tasks")
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: tasks"))?;
            let mut new_tasks = Vec::with_capacity(raw_tasks.len());
            for raw in raw_tasks {
                let new: NewTask = serde_json::from_value(raw.clone())
                    .map_err(|e| anyhow::anyhow!("invalid task entry: {e}"))?;
                new_tasks.push(new);
            }
            Ok(serde_json::to_value(
                db.create_tasks(project_id, &new_tasks, &actor)?,
            )?)
        }
        "update_task_status" => {
            let status: Status = args
                .get("status")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: status"))?
                .parse()?;
            Ok(serde_json::to_value(db.set_status(
                require_id(args)?,
                status,
                &actor,
            )?)?)
        }
        "add_task_comment" => {
            let author = args.get("author").and_then(Value::as_str).unwrap_or(&actor);
            let body = args
                .get("body")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: body"))?;
            Ok(serde_json::to_value(db.add_comment(
                require_id(args)?,
                author,
                body,
            )?)?)
        }
        "set_task_dependencies" => {
            let deps: Vec<i64> = args
                .get("depends_on")
                .and_then(Value::as_array)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: depends_on"))?
                .iter()
                .filter_map(Value::as_i64)
                .collect();
            Ok(serde_json::to_value(db.set_dependencies(
                require_id(args)?,
                &deps,
                &actor,
            )?)?)
        }
        "update_task" => {
            let update = TaskUpdate {
                title: opt_string(args, "title"),
                description: opt_string(args, "description"),
                assignee: opt_string(args, "assignee"),
                priority: opt_parse::<Priority>(args, "priority")?,
                position: None,
                estimate_points: args.get("estimate_points").and_then(|v| v.as_f64()),
            };
            Ok(serde_json::to_value(db.update_task(
                require_id(args)?,
                &update,
                &actor,
            )?)?)
        }
        "delete_task" => {
            let id = require_id(args)?;
            db.delete_task(id)?;
            Ok(json!({"deleted": id}))
        }
        "delete_project" => {
            let project_id = args
                .get("project_id")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: project_id"))?;
            let project = db.find_project(&project_id.to_string())?;
            db.delete_project(project.id)?;
            Ok(json!({"deleted": project.id, "name": project.name}))
        }
        "get_briefing" => {
            let project_id = args
                .get("project_id")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: project_id"))?;
            Ok(serde_json::to_value(db.get_briefing_by_id(project_id)?)?)
        }
        "set_project_context" => {
            let project_id = args
                .get("project_id")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: project_id"))?;
            let original_request = require_str(args, "original_request")?;
            let plan_summary = require_str(args, "plan_summary")?;
            Ok(serde_json::to_value(db.set_project_context_by_id(
                project_id,
                original_request,
                plan_summary,
            )?)?)
        }
        "save_handoff" => {
            let project_id = args
                .get("project_id")
                .and_then(Value::as_i64)
                .ok_or_else(|| anyhow::anyhow!("missing required argument: project_id"))?;
            let note = require_str(args, "note")?;
            let session_id = args.get("session_id").and_then(Value::as_str).unwrap_or("");
            let current_task_id = args.get("current_task_id").and_then(Value::as_i64);
            Ok(serde_json::to_value(db.set_handoff_by_id(
                project_id,
                &actor,
                session_id,
                note,
                current_task_id,
            )?)?)
        }
        other => anyhow::bail!("unknown tool: {other}"),
    }
}

fn require_id(args: &Value) -> anyhow::Result<i64> {
    args.get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("missing required argument: id"))
}

fn require_i64(args: &Value, key: &str) -> anyhow::Result<i64> {
    args.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("missing required argument: {key}"))
}

/// Link a project to a user story given an id or a pasted entity URL.
fn link_user_story(
    db: &Db,
    project_id: i64,
    story: &str,
) -> anyhow::Result<taskboard_core::Project> {
    let id = taskboard_core::tp::client::parse_entity_id(story).ok_or_else(|| {
        anyhow::anyhow!("'{story}' is not a user story id or a TargetProcess entity URL")
    })?;
    Ok(db.link_tp_project(project_id, id)?)
}

fn require_str<'a>(args: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("missing required argument: {key}"))
}

fn opt_string(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_string)
}

fn opt_parse<T: FromStr>(args: &Value, key: &str) -> anyhow::Result<Option<T>>
where
    T::Err: std::error::Error + Send + Sync + 'static,
{
    match args.get(key).and_then(Value::as_str) {
        Some(s) if !s.is_empty() => Ok(Some(s.parse::<T>()?)),
        _ => Ok(None),
    }
}
