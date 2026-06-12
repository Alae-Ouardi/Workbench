//! Tauri commands exposing taskboard-core to the frontend.
//! Actions performed in the app are recorded with the actor "me".

use std::str::FromStr;

use tauri::{AppHandle, Manager};
use taskboard_core::{
    Briefing, Comment, Db, Kind, NewTask, Priority, Project, ProjectSummary, Status, StatusChange,
    Task, TaskDetail, TaskFilter, TaskUpdate,
};

const APP_ACTOR: &str = "me";

fn db() -> Result<Db, String> {
    Db::open_default().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectSummary>, String> {
    db()?.list_projects().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tasks(project_id: Option<i64>, status: Option<String>) -> Result<Vec<Task>, String> {
    let filter = TaskFilter {
        project_id,
        status: status
            .as_deref()
            .map(Status::from_str)
            .transpose()
            .map_err(|e| e.to_string())?,
        assignee: None,
    };
    db()?.list_tasks(&filter).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_task(id: i64) -> Result<TaskDetail, String> {
    db()?.get_task(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(
    project_path: String,
    title: String,
    description: String,
    kind: String,
    priority: String,
    assignee: String,
) -> Result<Task, String> {
    let new = NewTask {
        title,
        description,
        assignee,
        kind: Some(Kind::from_str(&kind).map_err(|e| e.to_string())?),
        priority: Some(Priority::from_str(&priority).map_err(|e| e.to_string())?),
        depends_on: Vec::new(),
    };
    db()?
        .create_task(&project_path, &new, APP_ACTOR)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_status(id: i64, status: String) -> Result<StatusChange, String> {
    let status = Status::from_str(&status).map_err(|e| e.to_string())?;
    db()?
        .set_status(id, status, APP_ACTOR)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task(
    id: i64,
    title: Option<String>,
    description: Option<String>,
    assignee: Option<String>,
    priority: Option<String>,
) -> Result<Task, String> {
    let update = TaskUpdate {
        title,
        description,
        assignee,
        priority: priority
            .as_deref()
            .map(Priority::from_str)
            .transpose()
            .map_err(|e| e.to_string())?,
        position: None,
    };
    db()?
        .update_task(id, &update, APP_ACTOR)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_comment(id: i64, body: String) -> Result<Comment, String> {
    db()?
        .add_comment(id, APP_ACTOR, &body)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_dependencies(id: i64, depends_on: Vec<i64>) -> Result<Task, String> {
    db()?
        .set_dependencies(id, &depends_on, APP_ACTOR)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(id: i64) -> Result<(), String> {
    db()?.delete_task(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_project(project_id: i64) -> Result<(), String> {
    db()?.delete_project(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_briefing(project_id: i64) -> Result<Briefing, String> {
    let db = db()?;
    let project = db
        .find_project(&project_id.to_string())
        .map_err(|e| e.to_string())?;
    db.get_briefing(&project.path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project(path: String, name: String, description: String) -> Result<Project, String> {
    db()?
        .create_project(&path, &name, &description)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn update_project_context(
    project_id: i64,
    original_request: String,
    plan_summary: String,
) -> Result<Project, String> {
    let db = db()?;
    let project = db
        .find_project(&project_id.to_string())
        .map_err(|e| e.to_string())?;
    db.set_project_context(&project.path, &original_request, &plan_summary)
        .map_err(|e| e.to_string())
}
