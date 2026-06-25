use crate::*;

fn db() -> Db {
    Db::open_in_memory().unwrap()
}

fn task(title: &str) -> NewTask {
    NewTask {
        title: title.to_string(),
        ..Default::default()
    }
}

#[test]
fn create_and_get_roundtrip() {
    let db = db();
    let t = db
        .create_task(
            "/tmp/proj-a",
            &NewTask {
                title: "Build the thing".into(),
                description: "details".into(),
                assignee: "claude-code".into(),
                priority: Some(Priority::High),
                kind: Some(Kind::Bug),
                ..Default::default()
            },
            "claude-code",
        )
        .unwrap();
    assert_eq!(t.status, Status::Open);
    assert_eq!(t.kind, Kind::Bug);
    assert_eq!(t.priority, Priority::High);

    let detail = db.get_task(t.id).unwrap();
    assert_eq!(detail.task.title, "Build the thing");
    assert_eq!(detail.events.len(), 1);
    assert_eq!(detail.events[0].kind, "created");
}

#[test]
fn ensure_project_dedupes_by_path() {
    let db = db();
    let a = db.ensure_project("/tmp/proj-a", None).unwrap();
    let b = db.ensure_project("/tmp/proj-a", Some("ignored")).unwrap();
    assert_eq!(a.id, b.id);
    assert_eq!(a.name, "proj-a");
}

#[test]
fn project_resolves_to_git_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    std::fs::create_dir_all(root.join(".git")).unwrap();
    let nested = root.join("src/deep");
    std::fs::create_dir_all(&nested).unwrap();

    let db = db();
    let from_nested = db
        .ensure_project(nested.to_str().unwrap(), None)
        .unwrap();
    let from_root = db.ensure_project(root.to_str().unwrap(), None).unwrap();
    assert_eq!(from_nested.id, from_root.id);
}

#[test]
fn dependencies_make_task_waiting_and_auto_promote() {
    let db = db();
    let a = db.create_task("/tmp/p", &task("A"), "ai").unwrap();
    let b = db
        .create_task(
            "/tmp/p",
            &NewTask {
                title: "B".into(),
                depends_on: vec![a.id],
                ..Default::default()
            },
            "ai",
        )
        .unwrap();
    assert_eq!(b.status, Status::Waiting);

    let change = db.set_status(a.id, Status::Done, "ai").unwrap();
    assert_eq!(change.task.status, Status::Done);
    assert_eq!(change.promoted.len(), 1);
    assert_eq!(change.promoted[0].id, b.id);
    assert_eq!(change.promoted[0].status, Status::Open);
}

#[test]
fn promotion_waits_for_all_dependencies() {
    let db = db();
    let a = db.create_task("/tmp/p", &task("A"), "ai").unwrap();
    let b = db.create_task("/tmp/p", &task("B"), "ai").unwrap();
    let c = db
        .create_task(
            "/tmp/p",
            &NewTask {
                title: "C".into(),
                depends_on: vec![a.id, b.id],
                ..Default::default()
            },
            "ai",
        )
        .unwrap();
    assert_eq!(c.status, Status::Waiting);

    let change = db.set_status(a.id, Status::Done, "ai").unwrap();
    assert!(change.promoted.is_empty());

    let change = db.set_status(b.id, Status::Done, "ai").unwrap();
    assert_eq!(change.promoted.len(), 1);
    assert_eq!(change.promoted[0].id, c.id);
}

#[test]
fn batch_create_supports_negative_index_deps() {
    let db = db();
    let tasks = db
        .create_tasks(
            "/tmp/p",
            &[
                task("first"),
                NewTask {
                    title: "second".into(),
                    depends_on: vec![-1],
                    ..Default::default()
                },
            ],
            "ai",
        )
        .unwrap();
    assert_eq!(tasks.len(), 2);
    assert_eq!(tasks[1].status, Status::Waiting);
    let detail = db.get_task(tasks[1].id).unwrap();
    assert_eq!(detail.depends_on.len(), 1);
    assert_eq!(detail.depends_on[0].id, tasks[0].id);
}

#[test]
fn cycle_and_self_dependency_rejected() {
    let db = db();
    let a = db.create_task("/tmp/p", &task("A"), "ai").unwrap();
    let b = db
        .create_task(
            "/tmp/p",
            &NewTask {
                title: "B".into(),
                depends_on: vec![a.id],
                ..Default::default()
            },
            "ai",
        )
        .unwrap();

    assert!(matches!(
        db.set_dependencies(a.id, &[a.id], "ai"),
        Err(Error::SelfDependency)
    ));
    assert!(matches!(
        db.set_dependencies(a.id, &[b.id], "ai"),
        Err(Error::DependencyCycle { .. })
    ));
}

#[test]
fn clearing_dependencies_reopens_waiting_task() {
    let db = db();
    let a = db.create_task("/tmp/p", &task("A"), "ai").unwrap();
    let b = db
        .create_task(
            "/tmp/p",
            &NewTask {
                title: "B".into(),
                depends_on: vec![a.id],
                ..Default::default()
            },
            "ai",
        )
        .unwrap();
    assert_eq!(b.status, Status::Waiting);
    let b = db.set_dependencies(b.id, &[], "ai").unwrap();
    assert_eq!(b.status, Status::Open);
}

#[test]
fn comments_are_recorded_with_events() {
    let db = db();
    let t = db.create_task("/tmp/p", &task("T"), "claude").unwrap();
    db.add_comment(t.id, "claude", "handing off: did X, next do Y")
        .unwrap();
    let detail = db.get_task(t.id).unwrap();
    assert_eq!(detail.comments.len(), 1);
    assert!(detail.events.iter().any(|e| e.kind == "commented"));
}

#[test]
fn list_tasks_filters_by_project_and_status() {
    let db = db();
    let t1 = db.create_task("/tmp/p1", &task("one"), "ai").unwrap();
    let _t2 = db.create_task("/tmp/p2", &task("two"), "ai").unwrap();
    db.set_status(t1.id, Status::InProgress, "ai").unwrap();

    let all = db.list_tasks(&TaskFilter::default()).unwrap();
    assert_eq!(all.len(), 2);

    let p1_only = db
        .list_tasks(&TaskFilter {
            project_id: Some(t1.project_id),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(p1_only.len(), 1);

    let in_progress = db
        .list_tasks(&TaskFilter {
            status: Some(Status::InProgress),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(in_progress.len(), 1);
    assert_eq!(in_progress[0].id, t1.id);
}

#[test]
fn invalid_status_string_is_rejected() {
    assert!("bogus".parse::<Status>().is_err());
    assert!("in_progress".parse::<Status>().is_ok());
}

#[test]
fn update_and_delete_task() {
    let db = db();
    let t = db.create_task("/tmp/p", &task("old"), "me").unwrap();
    let updated = db
        .update_task(
            t.id,
            &TaskUpdate {
                title: Some("new title".into()),
                assignee: Some("codex".into()),
                ..Default::default()
            },
            "me",
        )
        .unwrap();
    assert_eq!(updated.title, "new title");
    assert_eq!(updated.assignee, "codex");

    db.delete_task(t.id).unwrap();
    assert!(matches!(db.get_task(t.id), Err(Error::TaskNotFound(_))));
}

#[test]
fn project_summary_counts() {
    let db = db();
    let t1 = db.create_task("/tmp/px", &task("a"), "ai").unwrap();
    let _ = db.create_task("/tmp/px", &task("b"), "ai").unwrap();
    db.set_status(t1.id, Status::Done, "ai").unwrap();

    let projects = db.list_projects().unwrap();
    let p = projects
        .iter()
        .find(|p| p.project.id == t1.project_id)
        .unwrap();
    assert_eq!(p.open, 1);
    assert_eq!(p.done, 1);
}

// --- context & handoff ---

#[test]
fn set_project_context_roundtrip() {
    let db = db();
    db.create_task("/tmp/ctx", &task("seed"), "ai").unwrap();
    let p = db
        .set_project_context("/tmp/ctx", "add multi-currency support", "1. model\n2. service")
        .unwrap();
    assert_eq!(p.original_request, "add multi-currency support");
    assert_eq!(p.plan_summary, "1. model\n2. service");

    // Persisted and visible via list_projects too.
    let summary = db
        .list_projects()
        .unwrap()
        .into_iter()
        .find(|s| s.project.id == p.id)
        .unwrap();
    assert_eq!(summary.project.original_request, "add multi-currency support");
}

#[test]
fn set_project_context_autocreates_project() {
    let db = db();
    let p = db
        .set_project_context("/tmp/brand-new", "do the thing", "plan")
        .unwrap();
    assert_eq!(p.original_request, "do the thing");
    assert!(db.find_project_by_path("/tmp/brand-new").unwrap().is_some());
}

#[test]
fn set_handoff_records_state_and_event() {
    let db = db();
    let t = db.create_task("/tmp/h", &task("work"), "ai").unwrap();
    let p = db
        .set_handoff("/tmp/h", "claude-code", "sess-abc", "half done, do rounding next", Some(t.id))
        .unwrap();
    assert_eq!(p.last_actor, "claude-code");
    assert_eq!(p.last_session_id, "sess-abc");
    assert_eq!(p.handoff_note, "half done, do rounding next");
    assert_eq!(p.current_task_id, Some(t.id));
    assert!(p.handoff_updated_at.is_some());

    // Handoff is recorded on the task timeline.
    let detail = db.get_task(t.id).unwrap();
    assert!(detail.events.iter().any(|e| e.kind == "handoff"));
}

#[test]
fn briefing_resume_uses_flag_when_not_done() {
    let db = db();
    let a = db.create_task("/tmp/b", &task("A"), "ai").unwrap();
    let b = db.create_task("/tmp/b", &task("B"), "ai").unwrap();
    db.set_handoff("/tmp/b", "codex", "s1", "on B", Some(b.id))
        .unwrap();

    let briefing = db.get_briefing("/tmp/b").unwrap();
    assert_eq!(briefing.resume_task.as_ref().unwrap().id, b.id);
    assert_eq!(briefing.tasks.len(), 2);
    assert_eq!(briefing.project.last_session_id, "s1");
    let _ = a;
}

#[test]
fn briefing_resume_falls_back_when_flag_done() {
    let db = db();
    let a = db.create_task("/tmp/bf", &task("A"), "ai").unwrap();
    let b = db.create_task("/tmp/bf", &task("B"), "ai").unwrap();
    db.set_handoff("/tmp/bf", "codex", "s", "on A", Some(a.id))
        .unwrap();
    // Flagged task A is completed -> resume should fall back to next open (B).
    db.set_status(a.id, Status::Done, "ai").unwrap();

    let briefing = db.get_briefing("/tmp/bf").unwrap();
    assert_eq!(briefing.resume_task.as_ref().unwrap().id, b.id);
}

#[test]
fn briefing_resume_first_open_with_no_flag() {
    let db = db();
    let a = db.create_task("/tmp/nf", &task("A"), "ai").unwrap();
    let _b = db.create_task("/tmp/nf", &task("B"), "ai").unwrap();

    let briefing = db.get_briefing("/tmp/nf").unwrap();
    // No handoff flag set -> first open task by order.
    assert_eq!(briefing.resume_task.as_ref().unwrap().id, a.id);
}

#[test]
fn briefing_prefers_in_progress_over_open() {
    let db = db();
    let _a = db.create_task("/tmp/ip", &task("A"), "ai").unwrap();
    let b = db.create_task("/tmp/ip", &task("B"), "ai").unwrap();
    db.set_status(b.id, Status::InProgress, "ai").unwrap();

    let briefing = db.get_briefing("/tmp/ip").unwrap();
    assert_eq!(briefing.resume_task.as_ref().unwrap().id, b.id);
}

#[test]
fn briefing_resume_none_when_all_done() {
    let db = db();
    let a = db.create_task("/tmp/ad", &task("A"), "ai").unwrap();
    db.set_status(a.id, Status::Done, "ai").unwrap();

    let briefing = db.get_briefing("/tmp/ad").unwrap();
    assert!(briefing.resume_task.is_none());
}

#[test]
fn create_project_sets_name_and_brief() {
    let db = db();
    let p = db
        .create_project("/tmp/new-proj", "My App", "Build a task manager with AI support")
        .unwrap();
    assert_eq!(p.name, "My App");
    assert_eq!(p.original_request, "Build a task manager with AI support");
    assert_eq!(p.path, "/tmp/new-proj");

    // Calling again on the same path creates a second request-project.
    let p2 = db
        .create_project("/tmp/new-proj", "My App v2", "Updated brief")
        .unwrap();
    assert_ne!(p2.id, p.id); // new project row
    assert_eq!(p2.name, "My App v2");
    assert_eq!(p2.original_request, "Updated brief");
}

#[test]
fn migration_adds_columns_to_legacy_projects_table() {

    // Simulate a pre-handoff DB: create a projects table with only the original
    // four columns, then open it through Db and confirm the migration ran.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("legacy.db");
    {
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, \
             path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
             INSERT INTO projects (name, path, created_at) VALUES ('old', '/tmp/old', '2020-01-01');",
        )
        .unwrap();
    }
    let db = Db::open(&path).unwrap();
    let p = db.find_project_by_path("/tmp/old").unwrap().unwrap();
    assert_eq!(p.name, "old");
    assert_eq!(p.original_request, ""); // new column present with default
    // And the new context can be written to the migrated row.
    let p = db
        .set_project_context("/tmp/old", "legacy request", "legacy plan")
        .unwrap();
    assert_eq!(p.original_request, "legacy request");
}
