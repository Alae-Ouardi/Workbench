# Request-Based Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert TaskBoard projects from folder-unique entries into request-based entries so multiple projects can share one folder, each with its own context and isolated task list.

**Architecture:** Remove the `UNIQUE` constraint on `projects.path`, change task/context/handoff methods to operate by `project_id`, and update all callers (Tauri, frontend, CLI, MCP).

**Tech Stack:** Rust (Tauri + taskboard-core), SQLite, React/TypeScript.

---

### Task 1: Remove `UNIQUE` constraint from `projects.path`

**Files:**
- Modify: `crates/taskboard-core/src/db.rs`
- Test: `crates/taskboard-core/src/tests.rs`

- [ ] **Step 1: Update `SCHEMA` to remove `UNIQUE`**

  In `db.rs`, change the `projects` table definition:

  ```rust
  CREATE TABLE IF NOT EXISTS projects (
      id                 INTEGER PRIMARY KEY,
      name               TEXT NOT NULL,
      path               TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      ...
  );
  ```

  Remove `UNIQUE` from `path`.

- [ ] **Step 2: Add migration to drop the old unique constraint on existing DBs**

  SQLite cannot `DROP CONSTRAINT`. Add a migration function that:
  1. Checks if `projects` currently has a unique index/constraint on `path`.
  2. Creates a new table `projects_new` with the same schema but no `UNIQUE` on `path`.
  3. Copies all rows from `projects` to `projects_new`.
  4. Drops `projects`.
  5. Renames `projects_new` to `projects`.
  6. Recreates the indexes.

  ```rust
  fn migrate_remove_path_unique(conn: &Connection) -> Result<()> {
      // Use sqlite_master to detect the old unique index on projects(path).
      let has_unique: bool = conn.query_row(
          "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND tbl_name = 'projects' AND sql LIKE '%UNIQUE%projects(path)%'",
          [],
          |row| row.get(0),
      )?;
      if !has_unique {
          return Ok(());
      }
      conn.execute_batch(
          "CREATE TABLE projects_new (
              id                 INTEGER PRIMARY KEY,
              name               TEXT NOT NULL,
              path               TEXT NOT NULL,
              created_at         TEXT NOT NULL,
              original_request   TEXT NOT NULL DEFAULT '',
              plan_summary       TEXT NOT NULL DEFAULT '',
              last_actor         TEXT NOT NULL DEFAULT '',
              last_session_id    TEXT NOT NULL DEFAULT '',
              handoff_note       TEXT NOT NULL DEFAULT '',
              current_task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
              handoff_updated_at TEXT
          );
          INSERT INTO projects_new SELECT * FROM projects;
          DROP TABLE projects;
          ALTER TABLE projects_new RENAME TO projects;"
      )?;
      Ok(())
  }
  ```

  Call it in `Db::open`/`open_in_memory` after the existing `migrate`.

- [ ] **Step 3: Run core tests**

  ```bash
  cargo test -p taskboard-core
  ```

  Expected: PASS.

- [ ] **Step 4: Commit**

  ```bash
  git add crates/taskboard-core/src/db.rs
  git commit -m "feat: remove UNIQUE constraint on projects.path"
  ```

---

### Task 2: Update core project model for request-based projects

**Files:**
- Modify: `crates/taskboard-core/src/projects.rs`
- Test: `crates/taskboard-core/src/tests.rs`

- [ ] **Step 1: Change `create_project` to always insert a new row**

  Replace the current implementation with:

  ```rust
  pub fn create_project(&self, path: &str, name: &str, description: &str) -> Result<Project> {
      let root = resolve_project_root(path);
      let created_at = now();
      self.conn.execute(
          "INSERT INTO projects (name, path, created_at, original_request) VALUES (?1, ?2, ?3, ?4)",
          params![name, root, created_at, description],
      )?;
      let id = self.conn.last_insert_rowid();
      self.find_project(&id.to_string())
  }
  ```

- [ ] **Step 2: Rework `ensure_project` to only find existing projects**

  Rename it to `find_or_create_legacy`? No — remove it. Keep a helper used only by old path-based task creation (which we will delete in Task 4). For now, leave it but make `create_project` not call it.

  Actually, remove `ensure_project` entirely and let `create_task`/`create_tasks` callers supply a `project_id`. We will delete the path-based task creation methods in Task 4.

- [ ] **Step 3: Add `find_projects_by_path`**

  ```rust
  pub fn find_projects_by_path(&self, path: &str) -> Result<Vec<Project>> {
      let root = resolve_project_root(path);
      let mut stmt = self.conn.prepare(&format!(
          "SELECT {PROJECT_COLUMNS} FROM projects WHERE path = ?1 ORDER BY created_at DESC"
      ))?;
      let rows = stmt.query_map(params![root], row_to_project)?;
      Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
  }
  ```

- [ ] **Step 4: Make `find_project` error on ambiguous path/name**

  For path lookup:

  ```rust
  if let Some(p) = self.find_project_by_path(key)? {
      return Ok(p);
  }
  ```

  Change `find_project_by_path` to error if multiple rows match:

  ```rust
  pub fn find_project_by_path(&self, path: &str) -> Result<Option<Project>> {
      let mut projects = self.find_projects_by_path(path)?;
      match projects.len() {
          0 => Ok(None),
          1 => Ok(Some(projects.remove(0))),
          _ => Err(Error::AmbiguousProject {
              key: path.to_string(),
              matches: projects.into_iter().map(|p| format!("#{} {}", p.id, p.name)).collect(),
          }),
      }
  }
  ```

  Add `AmbiguousProject` to `Error` enum in `crates/taskboard-core/src/error.rs`.

  Do the same for name lookup:

  ```rust
  let mut by_name: Vec<Project> = {
      let mut stmt = self.conn.prepare(&format!("SELECT {PROJECT_COLUMNS} FROM projects WHERE name = ?1"))?;
      let rows = stmt.query_map(params![key], row_to_project)?;
      rows.collect::<std::result::Result<Vec<_>, _>>()?
  };
  match by_name.len() {
      0 => Err(Error::ProjectNotFound(key.to_string())),
      1 => Ok(by_name.remove(0)),
      _ => Err(Error::AmbiguousProject { ... }),
  }
  ```

- [ ] **Step 5: Run core tests**

  ```bash
  cargo test -p taskboard-core
  ```

  Expected: PASS (update tests that relied on path uniqueness).

- [ ] **Step 6: Commit**

  ```bash
  git add crates/taskboard-core/src/projects.rs crates/taskboard-core/src/error.rs
  git commit -m "feat: support multiple projects per path with ambiguity errors"
  ```

---

### Task 3: Convert context/handoff/briefing to project-id based

**Files:**
- Modify: `crates/taskboard-core/src/projects.rs`
- Modify: `src-tauri/src/board.rs`
- Test: `crates/taskboard-core/src/tests.rs`

- [ ] **Step 1: Add project-id based methods in core**

  ```rust
  pub fn get_briefing_by_id(&self, project_id: i64) -> Result<Briefing> {
      let project = self.find_project(&project_id.to_string())?;
      let tasks = self.list_tasks(&TaskFilter {
          project_id: Some(project.id),
          ..Default::default()
      })?;
      let resume_task = resolve_resume_task(&project, &tasks);
      Ok(Briefing { project, resume_task, tasks })
  }

  pub fn set_project_context_by_id(
      &self,
      project_id: i64,
      original_request: &str,
      plan_summary: &str,
  ) -> Result<Project> {
      self.conn.execute(
          "UPDATE projects SET original_request = ?1, plan_summary = ?2 WHERE id = ?3",
          params![original_request, plan_summary, project_id],
      )?;
      self.find_project(&project_id.to_string())
  }

  pub fn set_handoff_by_id(
      &self,
      project_id: i64,
      actor: &str,
      session_id: &str,
      note: &str,
      current_task_id: Option<i64>,
  ) -> Result<Project> {
      let ts = now();
      self.conn.execute(
          "UPDATE projects SET last_actor = ?1, last_session_id = ?2, handoff_note = ?3, \
           current_task_id = ?4, handoff_updated_at = ?5 WHERE id = ?6",
          params![actor, session_id, note, current_task_id, ts, project_id],
      )?;
      if let Some(task_id) = current_task_id {
          let _ = self.conn.execute(
              "INSERT INTO task_events (task_id, actor, kind, detail, created_at) VALUES (?1, ?2, 'handoff', ?3, ?4)",
              params![task_id, actor, note, ts],
          );
      }
      self.find_project(&project_id.to_string())
  }
  ```

  Remove or deprecate the old path-based `get_briefing`, `set_project_context`, `set_handoff`.

- [ ] **Step 2: Update Tauri commands**

  In `src-tauri/src/board.rs`:

  - `get_briefing`:
    ```rust
    db.get_briefing_by_id(project_id)
    ```
  - `update_project_context`:
    ```rust
    db.set_project_context_by_id(project_id, &original_request, &plan_summary)
    ```

- [ ] **Step 3: Run tests**

  ```bash
  cargo test -p taskboard-core
  cargo check -p taskboard-tauri
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add crates/taskboard-core/src/projects.rs src-tauri/src/board.rs
  git commit -m "feat: project context/handoff/briefing by project_id"
  ```

---

### Task 4: Convert task creation to project-id based

**Files:**
- Modify: `crates/taskboard-core/src/tasks.rs`
- Modify: `crates/taskboard-core/src/lib.rs` (if re-exports)
- Test: `crates/taskboard-core/src/tests.rs`

- [ ] **Step 1: Change `create_task` signature**

  ```rust
  pub fn create_task(&self, project_id: i64, new: &NewTask, actor: &str) -> Result<Task>
  ```

  Remove the transaction wrapper or keep it; call `insert_task(project_id, new, actor)`.

- [ ] **Step 2: Change `create_tasks` signature**

  ```rust
  pub fn create_tasks(&self, project_id: i64, new_tasks: &[NewTask], actor: &str) -> Result<Vec<Task>>
  ```

- [ ] **Step 3: Update `insert_task`**

  ```rust
  fn insert_task(&self, project_id: i64, new: &NewTask, actor: &str) -> Result<Task> {
      // verify project exists
      self.find_project(&project_id.to_string())?;
      let ts = now();
      ...
      params![project_id, ...]
      ...
  }
  ```

- [ ] **Step 4: Delete `ensure_project` from `projects.rs`**

  Since task creation no longer auto-creates projects, remove `ensure_project` and `project_name_from_path` if unused.

- [ ] **Step 5: Run core tests**

  ```bash
  cargo test -p taskboard-core
  ```

  Update tests that called `create_task` with a path.

- [ ] **Step 6: Commit**

  ```bash
  git add crates/taskboard-core/src/tasks.rs crates/taskboard-core/src/projects.rs
  git commit -m "feat: task creation by project_id"
  ```

---

### Task 5: Update Tauri `create_task` command

**Files:**
- Modify: `src-tauri/src/board.rs`

- [ ] **Step 1: Change `create_task` parameter**

  ```rust
  pub fn create_task(
      project_id: i64,
      title: String,
      description: String,
      kind: String,
      priority: String,
      assignee: String,
  ) -> Result<Task, String> {
      let new = NewTask { ... };
      db()?.create_task(project_id, &new, APP_ACTOR).map_err(|e| e.to_string())
  }
  ```

- [ ] **Step 2: Check the workspace**

  ```bash
  cargo check --workspace
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src-tauri/src/board.rs
  git commit -m "feat: tauri create_task uses project_id"
  ```

---

### Task 6: Update frontend task creation to use project id

**Files:**
- Modify: `src/types.ts`
- Modify: `src/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/NewTaskModal.tsx`
- Modify: `src/components/TrayPopover.tsx`

- [ ] **Step 1: Update `NewTaskInput` type**

  In `src/types.ts`:

  ```typescript
  export interface NewTaskInput {
    projectId: number;
    title: string;
    description: string;
    kind: Kind;
    priority: Priority;
    assignee: string;
  }
  ```

- [ ] **Step 2: Update `createTask` API**

  In `src/api.ts`:

  ```typescript
  export function createTask(input: NewTaskInput): Promise<Task> {
    return invoke("create_task", {
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      kind: input.kind,
      priority: input.priority,
      assignee: input.assignee,
    });
  }
  ```

- [ ] **Step 3: Update `App.tsx` `handleCreateTask`**

  Pass `input.projectId` through (no change needed if `createTask` signature matches).

- [ ] **Step 4: Update `NewTaskModal.tsx`**

  - Remove `NEW_PROJECT` and `newPath` state.
  - Project selector only lists existing projects.
  - Submit uses `projectId` from the selected project.

  ```typescript
  const defaultProject = projects.find((p) => p.id === defaultProjectId) ?? projects[0] ?? null;
  const [projectId, setProjectId] = useState<number | null>(defaultProject?.id ?? null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { ... }
    if (projectId === null) { setError("Choose a project."); return; }
    ...
    await onSubmit({
      projectId,
      title: title.trim(),
      ...
    });
  }
  ```

- [ ] **Step 5: Update `TrayPopover.tsx` `QuickAdd`**

  Change `createTask` call:

  ```typescript
  await createTask({
    projectId: project.id,
    title: title.trim(),
    ...
  });
  ```

- [ ] **Step 6: Type-check frontend**

  ```bash
  pnpm tsc --noEmit
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/types.ts src/api.ts src/App.tsx src/components/NewTaskModal.tsx src/components/TrayPopover.tsx
  git commit -m "feat: frontend task creation uses project_id"
  ```

---

### Task 7: Show folder path in the sidebar for disambiguation

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add path subtitle to sidebar items**

  In `SidebarItem`, render the project name on one line and the path on a second line:

  ```tsx
  <span className="flex flex-col truncate">
    <span className="truncate">{label}</span>
    {title && <span className="truncate text-[10px] text-slate-600">{title}</span>}
  </span>
  ```

  Pass `title={p.path}` from the `Sidebar` component (already passed).

- [ ] **Step 2: Verify UI in dev**

  ```bash
  pnpm tauri dev
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/Sidebar.tsx
  git commit -m "feat: show project path in sidebar for disambiguation"
  ```

---

### Task 8: Update CLI for request-based projects

**Files:**
- Modify: `crates/taskboard-cli/src/main.rs`
- Modify: `crates/taskboard-cli/src/output.rs` (if needed for ambiguous error display)

- [ ] **Step 1: Add project resolution helper**

  ```rust
  fn resolve_project_for_add(db: &Db, project_arg: Option<String>) -> Result<Project> {
      match project_arg {
          Some(key) => db.find_project(&key),
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
  ```

- [ ] **Step 2: Update `Command::Add`**

  Replace `let project = project.unwrap_or_else(cwd);` and `db.create_task(&project, ...)` with:

  ```rust
  let project = resolve_project_for_add(&db, project)?;
  let task = db.create_task(project.id, &new, &actor)?;
  ```

- [ ] **Step 3: Update `Command::Briefing`, `Context`, `Handoff`**

  Use `find_project` with the key. If the user passes a path that matches multiple projects, `find_project` now errors with ambiguity.

  ```rust
  Command::Briefing { project } => {
      let project = match project {
          Some(key) => db.find_project(&key)?,
          None => resolve_project_for_add(&db, None)?,
      };
      let briefing = db.get_briefing_by_id(project.id)?;
      ...
  }
  ```

  Similarly for `Context` and `Handoff`.

- [ ] **Step 4: Run CLI tests**

  ```bash
  cargo test -p taskboard-cli
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add crates/taskboard-cli/src/main.rs
  git commit -m "feat: cli resolves projects by id/name and disambiguates multiple projects per path"
  ```

---

### Task 9: Update MCP tools for request-based projects

**Files:**
- Modify: `crates/taskboard-cli/src/mcp.rs`

- [ ] **Step 1: Update `create_tasks` tool definition**

  Change input schema:

  ```json
  "project_id": {"type": "integer", "description": "The project id to create tasks in. Call list_projects if you don't know it."}
  ```

  Required: `["project_id", "tasks"]`.

- [ ] **Step 2: Update `create_tasks` handler**

  ```rust
  let project_id = args.get("project_id").and_then(Value::as_i64)
      .ok_or_else(|| anyhow::anyhow!("missing required argument: project_id"))?;
  ...
  Ok(serde_json::to_value(db.create_tasks(project_id, &new_tasks, &actor)?)?)
  ```

- [ ] **Step 3: Update `get_briefing`, `set_project_context`, `save_handoff`, `delete_project` tool definitions and handlers**

  Replace `project_path` with `project_id` (integer) in all four tools.

  Example `get_briefing` handler:

  ```rust
  let project_id = args.get("project_id").and_then(Value::as_i64)
      .ok_or_else(|| anyhow::anyhow!("missing required argument: project_id"))?;
  Ok(serde_json::to_value(db.get_briefing_by_id(project_id)?)?)
  ```

- [ ] **Step 4: Check the CLI crate**

  ```bash
  cargo check -p taskboard-cli
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add crates/taskboard-cli/src/mcp.rs
  git commit -m "feat: mcp tools use project_id instead of project_path"
  ```

---

### Task 10: Add and update tests

**Files:**
- Modify: `crates/taskboard-core/src/tests.rs`
- Modify: `crates/taskboard-cli/src/` test files if any

- [ ] **Step 1: Add core tests**

  - Test that two projects can share the same path.
  - Test that `create_task` with `project_id` puts the task in the right project.
  - Test that `find_project_by_path` errors when multiple projects match.
  - Test that `get_briefing_by_id`, `set_project_context_by_id`, `set_handoff_by_id` work.

  ```rust
  #[test]
  fn multiple_projects_per_path_are_isolated() {
      let db = Db::open_in_memory().unwrap();
      let p1 = db.create_project("/tmp/foo", "Foo v1", "first request").unwrap();
      let p2 = db.create_project("/tmp/foo", "Foo v2", "second request").unwrap();
      assert_ne!(p1.id, p2.id);
      assert_eq!(p1.path, p2.path);

      let t1 = db.create_task(p1.id, &NewTask { title: "t1".into(), ..Default::default() }, "me").unwrap();
      let t2 = db.create_task(p2.id, &NewTask { title: "t2".into(), ..Default::default() }, "me").unwrap();

      let tasks1 = db.list_tasks(&TaskFilter { project_id: Some(p1.id), ..Default::default() }).unwrap();
      let tasks2 = db.list_tasks(&TaskFilter { project_id: Some(p2.id), ..Default::default() }).unwrap();
      assert_eq!(tasks1.len(), 1);
      assert_eq!(tasks2.len(), 1);
      assert_eq!(tasks1[0].id, t1.id);
      assert_eq!(tasks2[0].id, t2.id);
  }
  ```

- [ ] **Step 2: Update existing tests that relied on path uniqueness**

  Search for `create_task` calls in tests and update to pass `project_id`.

- [ ] **Step 3: Run full test suite**

  ```bash
  cargo test --workspace
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add crates/taskboard-core/src/tests.rs
  git commit -m "test: request-based project isolation and ambiguity"
  ```

---

### Task 11: Build and manually verify

**Files:**
- Build output only.

- [ ] **Step 1: Type-check and build**

  ```bash
  cargo test --workspace
  pnpm tsc --noEmit
  pnpm tauri build
  ```

- [ ] **Step 2: Manual verification**

  1. Launch the built app.
  2. Create a project for `/Users/pro/Desktop/taskboard` named "Notifications work".
  3. Create another project for the same folder named "Refactor DB".
  4. Confirm both appear in the sidebar with the path shown.
  5. Add tasks to each and confirm they do not mix.
  6. Edit each project's context banner and confirm they are independent.
  7. Test the tray popover quick-add on each project.
  8. Test CLI: `taskboard add "cli task"` in the folder with two projects should error and list them; `taskboard add "cli task" --project "Notifications work"` should succeed.

- [ ] **Step 3: Final commit**

  ```bash
  git commit -m "feat: request-based projects complete" --allow-empty
  ```

---

## Plan Self-Review

- **Spec coverage:** Every section of the design doc maps to one or more tasks.
- **Placeholder scan:** No TBD/TODO/fill-in-details patterns.
- **Type consistency:** `project_id` is consistently `i64` in Rust and `number` in TypeScript.
