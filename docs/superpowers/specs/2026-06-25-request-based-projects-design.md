# Request-Based Projects Design

## Problem

Today a TaskBoard project is uniquely identified by its filesystem path. The
`projects.path` column has a `UNIQUE` constraint, and `Db::ensure_project`
returns the single existing project for a folder. The sidebar therefore shows
one entry per folder, and the project's `original_request` / `plan_summary`
becomes the context for every task ever created in that folder.

This breaks the AI workflow: a user can have many independent requests for the
same repo ("add notifications", "refactor the database layer", "fix login
bugs"), but they all share one context and one task list.

## Goal

Make the sidebar a list of **requests**, where each request is a project that
points to a folder/repo. Multiple projects may share the same folder, and each
project keeps its own context, handoff state, and isolated task list.

## Non-Goals

- Renaming the `projects` table or introducing a new `requests` entity. The
  existing `Project` type already represents what the user calls a request.
- Changing how dependencies, comments, events, or statuses work.
- Adding folder-level aggregation or grouping in the sidebar.

## Design

### 1. Data Model

- Remove the `UNIQUE` constraint from `projects.path`.
- Keep all existing columns (`id`, `name`, `path`, `created_at`, context,
  handoff).
- Tasks continue to belong to a project via `tasks.project_id`; no schema
  change is needed for tasks.

### 2. Core Backend (`crates/taskboard-core`)

- `Db::create_project(path, name, description)` always inserts a new project
  row. It still resolves `path` to its git root, but it never returns an
  existing project.
- Remove/replace `Db::ensure_project`. Task creation must be explicit about
  which project (request) the task belongs to.
- `Db::create_task` and `Db::create_tasks` change signature from
  `project_path: &str` to `project_id: i64`. They no longer auto-create
  projects.
- `Db::insert_task` uses the passed `project_id` directly.
- Replace path-based context/handoff/briefing methods with project-id versions:
  - `get_briefing(project_id: i64) -> Result<Briefing>`
  - `set_project_context(project_id: i64, original_request, plan_summary)`
  - `set_handoff(project_id: i64, actor, session_id, note, current_task_id)`
- `find_project(key: &str)` remains for CLI/MCP convenience. It accepts an id,
  path, or name. IDs are always unambiguous. If a path or name matches more
  than one project, it returns an error listing the matches.
- Add `find_projects_by_path(path: &str) -> Result<Vec<Project>>` for CLI
  disambiguation and default selection.

### 3. Tauri Commands (`src-tauri/src/board.rs`)

- `create_task`: change parameter from `project_path: String` to
  `project_id: i64`.
- `get_briefing`: use `db.get_briefing(project_id)`.
- `update_project_context`: use `db.set_project_context(project_id, ...)`.
- `create_project`, `delete_project`, `list_projects`, `list_tasks`,
  `get_task`, `set_status`, `update_task`, `add_comment`, `set_dependencies`,
  `delete_task`, `show_main_window`: no changes.

### 4. Frontend

- `src/api.ts`: `createTask` takes `projectId: number` instead of
  `projectPath: string`.
- `src/App.tsx`: `handleCreateTask` passes `input.projectId` to `createTask`.
- `src/components/NewTaskModal.tsx`: the project selector uses project ids.
  Remove the "New project (enter path)…" option; creating a task must target
  an existing project.
- `src/components/TrayPopover.tsx`: `QuickAdd` uses `project.id` instead of
  `project.path` when calling `createTask`.
- `src/components/Sidebar.tsx`: show each project's folder path as a second
  line under the project name so multiple request-projects for the same
  folder are distinguishable.
- `src/components/ContextBanner.tsx`: no changes; it already renders context
  per project.

### 5. CLI (`crates/taskboard-cli/src/main.rs`)

- `taskboard add`:
  - `--project` accepts a project id or name.
  - If `--project` is omitted, look up projects for the current directory:
    - exactly one match → use it;
    - zero matches → error and instruct the user to create a project first;
    - more than one match → error and list the matching project ids/names.
- `taskboard briefing`, `context`, `handoff`:
  - `--project` accepts a project id or name.
  - If a path or name is ambiguous, error and list matches.
- `taskboard list --project`, `delete-project`: unchanged resolution logic
  (they already resolve to a project id).

### 6. MCP (`crates/taskboard-cli/src/mcp.rs`)

- `create_tasks`: change parameter from `project_path` to `project_id`
  (integer). Update the tool description to tell AIs to call `list_projects`
  if they do not already know the id.
- `get_briefing`, `set_project_context`, `save_handoff`, `delete_project`:
  change from `project_path` to `project_id` (integer).
- `list_projects`, `list_tasks`, task mutation tools: unchanged.

### 7. Migration

- Existing projects and tasks keep their rows.
- Remove the `UNIQUE` constraint via migration if it exists. SQLite does not
  expose `ALTER TABLE DROP CONSTRAINT`; we will create a new table without the
  constraint, copy data, drop the old table, and rename. Foreign keys to
  `tasks.project_id` will be preserved.
- No data rewrite is needed.

## Acceptance Criteria

1. A user can create two projects for the same folder, each with a different
   name and context.
2. Tasks created in project A do not appear in project B, even if both point
   to the same folder.
3. The sidebar shows both projects, with the folder path visible so they can
   be told apart.
4. The frontend "New task" button creates the task in the currently selected
   project.
5. The tray popover quick-add creates the task in the selected project.
6. `taskboard add` without `--project` uses the single project for the cwd or
   errors clearly if there are multiple.
7. MCP tools operate by `project_id` and no longer rely on path uniqueness.
8. Existing projects and tasks survive the migration unchanged.
