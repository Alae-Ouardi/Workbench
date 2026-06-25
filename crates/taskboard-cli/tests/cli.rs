use assert_cmd::Command;
use predicates::prelude::*;

fn cmd(db: &std::path::Path) -> Command {
    let mut c = Command::cargo_bin("taskboard").unwrap();
    c.env("TASKBOARD_DB", db);
    c
}

#[test]
fn cli_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("test.db");
    let proj = dir.path().join("myproj");
    std::fs::create_dir_all(&proj).unwrap();
    let proj = proj.to_str().unwrap();

    cmd(&db)
        .args(["create-project", "--path", proj, "--name", "myproj"])
        .assert()
        .success();

    cmd(&db)
        .args(["add", "First task", "--project", "myproj", "--bug", "--priority", "high"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Created #1 [open] First task"));

    cmd(&db)
        .args(["list", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"kind\": \"bug\""))
        .stdout(predicate::str::contains("\"priority\": \"high\""));

    cmd(&db)
        .args(["move", "1", "in_progress"])
        .assert()
        .success()
        .stdout(predicate::str::contains("#1 -> in_progress"));

    cmd(&db)
        .args(["comment", "1", "handoff: half done", "--actor", "claude-code"])
        .assert()
        .success();

    cmd(&db)
        .args(["show", "1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("in_progress"))
        .stdout(predicate::str::contains("handoff: half done"))
        .stdout(predicate::str::contains("claude-code"));

    cmd(&db)
        .args(["move", "1", "bogus"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("invalid status"));

    cmd(&db).args(["projects"]).assert().success().stdout(
        predicate::str::contains("myproj"),
    );
}

#[test]
fn cli_context_handoff_briefing() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("test.db");
    let proj = dir.path().join("p");
    std::fs::create_dir_all(&proj).unwrap();
    let proj = proj.to_str().unwrap();

    cmd(&db).args(["create-project", "--path", proj, "--name", "p"]).assert().success();

    cmd(&db).args(["add", "Task A", "--project", "p"]).assert().success();
    cmd(&db).args(["add", "Task B", "--project", "p"]).assert().success();

    cmd(&db)
        .args(["context", "--project", "p", "--request", "build the widget", "--plan", "1. A\n2. B"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Context set"));

    cmd(&db)
        .args(["handoff", "--project", "p", "--task", "2", "--session", "sess-xyz", "--note", "A done, B next", "--actor", "claude-code"])
        .assert()
        .success()
        .stdout(predicate::str::contains("stopped at #2"));

    cmd(&db)
        .args(["briefing", "--project", "p"])
        .assert()
        .success()
        .stdout(predicate::str::contains("build the widget"))
        .stdout(predicate::str::contains("sess-xyz"))
        .stdout(predicate::str::contains("Resume at #2"));

    // JSON briefing carries the resume task + session id.
    cmd(&db)
        .args(["briefing", "--project", "p", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"resume_task\""))
        .stdout(predicate::str::contains("\"last_session_id\": \"sess-xyz\""));
}

#[test]
fn mcp_server_initialize_and_create() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("test.db");
    let proj = dir.path().join("p");
    std::fs::create_dir_all(&proj).unwrap();

    // Create a project first so we have a project_id for create_tasks.
    let create_out = cmd(&db)
        .args(["create-project", "--path", proj.to_str().unwrap(), "--name", "p", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let project: serde_json::Value = serde_json::from_slice(&create_out).unwrap();
    let project_id = project["id"].as_i64().unwrap();

    let requests = format!(
        concat!(
            r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{"protocolVersion":"2025-06-18","capabilities":{{}},"clientInfo":{{"name":"test","version":"0"}}}}}}"#,
            "\n",
            r#"{{"jsonrpc":"2.0","method":"notifications/initialized"}}"#,
            "\n",
            r#"{{"jsonrpc":"2.0","id":2,"method":"tools/list"}}"#,
            "\n",
            r#"{{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{{"name":"create_tasks","arguments":{{"project_id":{project_id},"actor":"test-ai","tasks":[{{"title":"step 1"}},{{"title":"step 2","depends_on":[-1]}}]}}}}}}"#,
            "\n",
            r#"{{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{{"name":"list_tasks","arguments":{{}}}}}}"#,
            "\n"
        ),
        project_id = project_id
    );

    let assert = cmd(&db).arg("mcp").write_stdin(requests).assert().success();
    let out = String::from_utf8(assert.get_output().stdout.clone()).unwrap();
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines.len(), 4, "one response per request: {out}");

    let init: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(init["result"]["serverInfo"]["name"], "taskboard");

    let tools: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
    let names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"create_tasks"));
    assert!(names.contains(&"update_task_status"));
    assert!(names.contains(&"add_task_comment"));

    let created: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
    let text = created["result"]["content"][0]["text"].as_str().unwrap();
    assert!(created["result"]["isError"].is_null(), "create failed: {text}");
    let tasks: serde_json::Value = serde_json::from_str(text).unwrap();
    assert_eq!(tasks.as_array().unwrap().len(), 2);
    assert_eq!(tasks[0]["status"], "open");
    assert_eq!(tasks[1]["status"], "waiting");

    let listed: serde_json::Value = serde_json::from_str(lines[3]).unwrap();
    let text = listed["result"]["content"][0]["text"].as_str().unwrap();
    let tasks: serde_json::Value = serde_json::from_str(text).unwrap();
    assert_eq!(tasks.as_array().unwrap().len(), 2);
}
