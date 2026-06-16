# Sticky "All Done" Project Notification

## Context

TaskBoard already fires native macOS notifications for individual task changes (status transitions, new tasks). Users requested an additional, persistent notification that appears only when **all tasks in a project are finished**, so they can notice the milestone and act on it.

## Goals

- Notify the user when a project transitions from "has active tasks" to "all tasks done".
- Use both a native OS notification and a sticky in-app banner.
- Fire only on the transition, not continuously while the project remains done.
- Keep the implementation consistent with the existing backend-driven notification architecture.

## Non-goals

- Archiving or closing projects automatically.
- Providing action buttons on the native notification.
- Tracking per-user or per-assignee completion.

## Design

### Trigger condition

A project is considered "all done" when its count of non-done tasks (`open`, `waiting`, `in_progress`, `review`) transitions from greater than zero to exactly zero, and the project has at least one task marked `done`.

This guard prevents:

- Empty projects from firing at startup.
- Deletion of the last remaining tasks from being mistaken for completion.

### Architecture / data flow

```text
+-------------+      file change      +---------------------------+
| taskboard   |  ------------------>  | backend watcher           |
| DB          |                       | (src-tauri/src/watcher.rs)|
+-------------+                       +---------------------------+
                                               |
                                               v
                                      +---------------------------+
                                      | TaskSnapshot diff         |
                                      | (notifications.rs)        |
                                      +---------------------------+
                                               |
                        +----------------------+----------------------+
                        |                                             |
                        v                                             v
            +----------------------+                      +----------------------+
            | native OS notification |                    | project-all-done event |
            | title: 🎉 Project     |                    | { project_id, name }   |
            | complete — {name}     |                    +----------------------+
            | body: All tasks are done                     |
            +----------------------+                       v
                                                +----------------------+
                                                | React App.tsx listener |
                                                +----------------------+
                                                         |
                                                         v
                                                +----------------------+
                                                | ProjectDoneBanner      |
                                                | (sticky, dismissible)  |
                                                +----------------------+
```

### Backend changes

File: `src-tauri/src/notifications.rs`

- Extend `TaskSnapshot` to store, per project:
  - `project_name: String`
  - `active_count: usize` (tasks whose status is not `done`)
- `seed()` populates the project-active map from the current DB state without firing notifications or events.
- `diff_and_notify()`:
  1. Reads all tasks from the DB.
  2. Updates per-task snapshots (existing behavior).
  3. Builds a new per-project active-count map.
  4. For each project whose previous `active_count > 0` and current `active_count == 0` and current `done_count > 0`:
     - Fire a native notification.
     - Emit a `project-all-done` event to the frontend.
  5. Replaces the stored project-active map with the new one.
- Native notification:
  - Title: `🎉 Project complete — {project_name}`
  - Body: `All tasks are done.`
- Event payload (`serde` serialized):

  ```rust
  #[derive(Clone, Serialize)]
  struct ProjectAllDone {
      project_id: i64,
      project_name: String,
  }
  ```

- The existing `send()` helper can be reused for the native notification.
- Event emission uses `app.emit("project-all-done", payload)`; failures are silently ignored to avoid breaking the watcher loop.

### Frontend changes

Files:

- `src/api.ts`
- `src/App.tsx`
- `src/components/ProjectDoneBanner.tsx` (new)

`src/api.ts`:

- Add:

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

`src/App.tsx`:

- Add state:

  ```ts
  const [doneBanners, setDoneBanners] = useState<ProjectAllDone[]>([]);
  ```

- Register an event listener in a `useEffect`. When an event arrives, append the payload to `doneBanners` if not already present.
- Render `ProjectDoneBanner` instances above the board content area. Provide a dismiss handler that removes that banner from `doneBanners`.

`src/components/ProjectDoneBanner.tsx`:

- Props:

  ```ts
  interface ProjectDoneBannerProps {
    projectName: string;
    onDismiss: () => void;
  }
  ```

- Visual style:
  - Full-width banner.
  - Emerald/green background (`bg-emerald-500/10`) with emerald text.
  - Message: `🎉 Project complete — {projectName}. All tasks are done.`
  - Dismiss button (×) on the right.
- The banner stays visible until the user clicks the dismiss button.

### Edge cases and error handling

- **Empty project**: does not fire because `done_count` is zero.
- **All tasks deleted**: does not fire because `done_count` becomes zero.
- **Project already done at startup**: does not fire because `seed()` loads the current state without triggering transitions.
- **Multiple projects done in one diff**: each project fires its own notification and event; the frontend renders one banner per project.
- **Frontend closed**: native notifications still fire from the backend watcher.
- **Notification permission denied**: the existing plugin handles this silently; the event is still emitted so the in-app banner appears.

### Testing

- **Rust unit test** in `src-tauri/src/notifications.rs` (behind `#[cfg(test)]`):
  - Seed snapshot with two projects, each having one open task.
  - Simulate marking both tasks in project A as `done`.
  - Assert that project A triggers the event and notification, and project B does not.
- **Manual test**:
  1. Run the app in dev mode.
  2. Select a project with multiple tasks.
  3. Mark each task as `done`.
  4. Verify a native notification appears and a sticky green banner appears in the app.
  5. Click the banner's dismiss button; verify it disappears and does not reappear on refresh.

## Open questions

None. All decisions were confirmed with the user during brainstorming.
