# Sticky "All Done" Project Notification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native OS notification and a sticky in-app banner that fire once when all tasks in a project transition to done.

**Architecture:** Extend the backend `TaskSnapshot` to track per-project active/done counts, detect `active > 0 → active == 0` transitions, fire a native notification, and emit a `project-all-done` Tauri event. The frontend listens for the event and renders a dismissible banner.

**Tech Stack:** Rust (Tauri 2), React 19 + TypeScript, Tailwind CSS.

**Commit policy:** Per the user, **do not commit**. Stage changes only and leave them in the working tree for the user to review/test before they commit.

---

## File map

| File | Responsibility |
|------|----------------|
| `src-tauri/src/notifications.rs` | Tracks per-project task counts, detects completion transitions, fires native notification, emits Tauri event. |
| `src/api.ts` | Exposes the `project-all-done` event listener to the frontend. |
| `src/App.tsx` | Maintains banner state, registers the event listener, renders banners above the board. |
| `src/components/ProjectDoneBanner.tsx` | New component: sticky, dismissible completion banner. |

---

## Task 1: Extend `TaskSnapshot` with project-state tracking

**Files:**
- Modify: `src-tauri/src/notifications.rs`

### Step 1: Write the failing test

Append a `#[cfg(test)]` module at the bottom of `src-tauri/src/notifications.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use taskboard_core::{Kind, Priority, Status, Task};

    fn task(id: i64, project_id: i64, project_name: &str, status: Status) -> Task {
        Task {
            id,
            project_id,
            project_name: project_name.to_string(),
            title: format!("Task {id}"),
            description: String::new(),
            status,
            kind: Kind::Task,
            assignee: "me".to_string(),
            priority: Priority::Normal,
            position: 0.0,
            created_at: "2026-06-16T00:00:00Z".to_string(),
            updated_at: "2026-06-16T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn detects_project_completion_when_last_active_task_becomes_done() {
        let snapshot = TaskSnapshot::default();
        snapshot.update(&[
            task(1, 10, "Alpha", Status::Open),
            task(2, 10, "Alpha", Status::Done),
        ]);
        let completed = snapshot.detect_completed_projects(&[
            task(1, 10, "Alpha", Status::Done),
            task(2, 10, "Alpha", Status::Done),
        ]);
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0], (10, "Alpha".to_string()));
    }

    #[test]
    fn does_not_fire_for_already_done_project() {
        let snapshot = TaskSnapshot::default();
        snapshot.update(&[task(1, 10, "Alpha", Status::Done)]);
        let completed = snapshot.detect_completed_projects(&[task(1, 10, "Alpha", Status::Done)]);
        assert!(completed.is_empty());
    }

    #[test]
    fn does_not_fire_for_empty_project() {
        let snapshot = TaskSnapshot::default();
        snapshot.update(&[]);
        let completed = snapshot.detect_completed_projects(&[]);
        assert!(completed.is_empty());
    }
}
```

### Step 2: Run the test and confirm it fails

```bash
cargo test -p taskboard-app notifications::tests
```

Expected: compile errors because `update` and `detect_completed_projects` do not exist yet.

### Step 3: Refactor `TaskSnapshot` to track project state

Replace the existing `TaskSnapshot` definition and `impl` block in `src-tauri/src/notifications.rs` with the structure below. Keep the existing `send`, `status_emoji`, and `truncate` helpers unchanged.

```rust
#[derive(Default, Clone)]
pub struct TaskSnapshot {
    inner: Arc<Mutex<Snapshot>>,
}

#[derive(Default)]
struct Snapshot {
    tasks: HashMap<i64, (Status, String)>,
    projects: HashMap<i64, ProjectState>,
}

struct ProjectState {
    name: String,
    active: usize,
    done: usize,
}

impl TaskSnapshot {
    /// Query the DB, diff against the snapshot, fire notifications, update snapshot.
    pub fn diff_and_notify(&self, app: &AppHandle) {
        let db = match Db::open_default() {
            Ok(db) => db,
            Err(_) => return,
        };
        let tasks = match db.list_tasks(&TaskFilter::default()) {
            Ok(t) => t,
            Err(_) => return,
        };

        let completed = self.detect_completed_projects(&tasks);
        for (project_id, project_name) in completed {
            send(
                app,
                &format!("🎉 Project complete — {project_name}"),
                "All tasks are done.",
            );
            let _ = app.emit(
                "project-all-done",
                ProjectAllDone {
                    project_id,
                    project_name,
                },
            );
        }

        self.update(&tasks);
    }

    /// Seed the snapshot without firing notifications.
    pub fn seed(&self) {
        let db = match Db::open_default() {
            Ok(db) => db,
            Err(_) => return,
        };
        let tasks = match db.list_tasks(&TaskFilter::default()) {
            Ok(t) => t,
            Err(_) => return,
        };
        self.update(&tasks);
    }

    fn detect_completed_projects(&self, tasks: &[Task]) -> Vec<(i64, String)> {
        let snapshot = self.inner.lock().unwrap();
        let current = project_states(tasks);
        let mut completed = Vec::new();
        for (id, state) in &current {
            if state.active == 0 && state.done > 0 {
                if let Some(prev) = snapshot.projects.get(id) {
                    if prev.active > 0 {
                        completed.push((*id, state.name.clone()));
                    }
                }
            }
        }
        completed
    }

    fn update(&self, tasks: &[Task]) {
        let mut snapshot = self.inner.lock().unwrap();
        snapshot.tasks.clear();
        for task in tasks {
            snapshot.tasks.insert(task.id, (task.status, task.title.clone()));
        }
        snapshot.projects = project_states(tasks);
    }
}

fn project_states(tasks: &[Task]) -> HashMap<i64, ProjectState> {
    let mut map: HashMap<i64, ProjectState> = HashMap::new();
    for task in tasks {
        let entry = map.entry(task.project_id).or_insert_with(|| ProjectState {
            name: task.project_name.clone(),
            active: 0,
            done: 0,
        });
        if task.status == Status::Done {
            entry.done += 1;
        } else {
            entry.active += 1;
        }
    }
    map
}

#[derive(Clone, Serialize)]
struct ProjectAllDone {
    project_id: i64,
    project_name: String,
}
```

### Step 4: Add the missing import

At the top of `src-tauri/src/notifications.rs`, change:

```rust
use tauri::AppHandle;
```

to:

```rust
use tauri::{AppHandle, Emitter};
```

### Step 5: Run the tests and confirm they pass

```bash
cargo test -p taskboard-app notifications::tests
```

Expected: all three tests pass.

### Step 6: Run `cargo check` for the Tauri crate

```bash
cargo check -p taskboard-app
```

Expected: no errors.

### Step 7: Stage changes

```bash
git add src-tauri/src/notifications.rs
```

---

## Task 2: Wire native notification and event emission

**Files:**
- Modify: `src-tauri/src/notifications.rs` (already modified in Task 1)

This task is already mostly done by the refactor in Task 1. Verify the following lines are present in `diff_and_notify`:

```rust
let completed = self.detect_completed_projects(&tasks);
for (project_id, project_name) in completed {
    send(
        app,
        &format!("🎉 Project complete — {project_name}"),
        "All tasks are done.",
    );
    let _ = app.emit(
        "project-all-done",
        ProjectAllDone {
            project_id,
            project_name,
        },
    );
}
```

### Step 1: Confirm `seed` populates project state

`seed()` should call `self.update(&tasks)`, which populates both task and project snapshots. The implementation in Task 1 already does this.

### Step 2: Run the full Rust test suite

```bash
cargo test -p taskboard-app
```

Expected: existing tests still pass; new tests pass.

### Step 3: Stage changes

```bash
git add src-tauri/src/notifications.rs
```

---

## Task 3: Expose the event in the frontend API

**Files:**
- Modify: `src/api.ts`

### Step 1: Add the type and listener

In `src/api.ts`, add to the imports from `./types`:

```ts
// no new type imports needed from ./types
```

Add near the bottom of the file, before the terminal section:

```ts
export interface ProjectAllDone {
  projectId: number;
  projectName: string;
}

export function onProjectAllDone(
  callback: (payload: ProjectAllDone) => void,
): Promise<UnlistenFn> {
  return listen<ProjectAllDone>("project-all-done", (event) => callback(event.payload));
}
```

### Step 2: Type-check

```bash
pnpm tsc --noEmit
```

Expected: no TypeScript errors.

### Step 3: Stage changes

```bash
git add src/api.ts
```

---

## Task 4: Manage banner state in `App.tsx`

**Files:**
- Modify: `src/App.tsx`

### Step 1: Update imports

Change:

```ts
import { createTask, deleteProject, listProjects, listTasks, onBoardChanged, setStatus } from "./api";
```

to:

```ts
import {
  createTask,
  deleteProject,
  listProjects,
  listTasks,
  onBoardChanged,
  onProjectAllDone,
  setStatus,
  type ProjectAllDone,
} from "./api";
```

Add the import for the new banner component:

```ts
import { ProjectDoneBanner } from "./components/ProjectDoneBanner";
```

### Step 2: Add banner state

After the existing `refreshKey` state:

```ts
const [doneBanners, setDoneBanners] = useState<ProjectAllDone[]>([]);
```

### Step 3: Register the event listener

Add a new `useEffect` after the existing listeners:

```ts
useEffect(() => {
  let unlisten: (() => void) | null = null;
  onProjectAllDone((payload) => {
    setDoneBanners((prev) =>
      prev.some((b) => b.projectId === payload.projectId) ? prev : [...prev, payload]
    );
  }).then((fn) => {
    unlisten = fn;
  });
  return () => {
    unlisten?.();
  };
}, []);
```

### Step 4: Render the banners inside the board panel

Inside the board panel `<div className="flex flex-1 flex-col overflow-hidden">`, add the banner list above `ContextBanner`:

```tsx
{panel === "board" && (
  <div className="flex flex-1 flex-col overflow-hidden">
    {doneBanners.map((banner) => (
      <ProjectDoneBanner
        key={banner.projectId}
        projectName={banner.projectName}
        onDismiss={() =>
          setDoneBanners((prev) => prev.filter((b) => b.projectId !== banner.projectId))
        }
      />
    ))}
    {selectedProjectId !== null && (
      <ContextBanner
        projectId={selectedProjectId}
        refreshKey={refreshKey}
        onResume={(id) => setOpenTaskId(id)}
      />
    )}
    <div className="flex-1 overflow-hidden">
      <Board
        tasks={visibleTasks}
        showProject={selectedProjectId === null}
        onMove={handleMove}
        onOpen={(id) => setOpenTaskId(id)}
      />
    </div>
  </div>
)}
```

### Step 5: Type-check

```bash
pnpm tsc --noEmit
```

Expected: no errors.

### Step 6: Stage changes

```bash
git add src/App.tsx
```

---

## Task 5: Create the `ProjectDoneBanner` component

**Files:**
- Create: `src/components/ProjectDoneBanner.tsx`

### Step 1: Write the component

```tsx
interface ProjectDoneBannerProps {
  projectName: string;
  onDismiss: () => void;
}

export function ProjectDoneBanner({ projectName, onDismiss }: ProjectDoneBannerProps) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300">
      <span>🎉 Project complete — {projectName}. All tasks are done.</span>
      <button
        onClick={onDismiss}
        className="text-lg leading-none text-emerald-400/70 hover:text-emerald-200"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
```

### Step 2: Type-check

```bash
pnpm tsc --noEmit
```

Expected: no errors.

### Step 3: Stage changes

```bash
git add src/components/ProjectDoneBanner.tsx
```

---

## Task 6: Manual verification

### Step 1: Start the dev build

```bash
pnpm tauri dev
```

### Step 2: Mark the last active task done

1. Select a project that has at least one non-done task.
2. Drag the last non-done task to the **Done** column (or change its status via the task drawer).
3. Observe:
   - A native macOS notification appears with title `🎉 Project complete — {project_name}` and body `All tasks are done.`
   - A green sticky banner appears at the top of the board.

### Step 3: Dismiss the banner

Click the **×** on the banner. It should disappear and stay gone after refreshes.

### Step 4: Reopen a task and verify no re-trigger

1. Reopen one of the done tasks.
2. Mark it done again.
3. The notification and banner should reappear exactly once (because the project transitioned again).

### Step 5: Verify an already-done project does not trigger

Select a project that is already fully done. No banner should appear, and no native notification should fire.

---

## Self-review checklist

- [ ] Spec coverage: backend detection, native notification, event emission, frontend listener, sticky banner, dismiss behavior, and edge cases are all covered by tasks above.
- [ ] Placeholder scan: no `TBD`, `TODO`, or vague steps.
- [ ] Type consistency: `ProjectAllDone` uses `project_id` / `project_name` in Rust and `projectId` / `projectName` in TypeScript (matching Tauri camelCase conversion for event payloads).
