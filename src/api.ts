import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Briefing,
  Comment,
  NewTaskInput,
  Project,
  ProjectSummary,
  Status,
  StatusChange,
  SyncQueueItem,
  SyncReport,
  Task,
  TaskDetail,
  TpSettings,
  TpSettingsView,
  TpUser,
  TpUserStory,
} from "./types";

export function listProjects(): Promise<ProjectSummary[]> {
  return invoke("list_projects");
}

export function listTasks(projectId: number | null): Promise<Task[]> {
  return invoke("list_tasks", { projectId, status: null });
}

export function getTask(id: number): Promise<TaskDetail> {
  return invoke("get_task", { id });
}

export function createTask(input: NewTaskInput): Promise<Task> {
  return invoke("create_task", {
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    kind: input.kind,
    priority: input.priority,
    assignee: input.assignee,
    estimatePoints: input.estimatePoints,
  });
}

export function setStatus(id: number, status: Status): Promise<StatusChange> {
  return invoke("set_status", { id, status });
}

export function addComment(id: number, body: string): Promise<Comment> {
  return invoke("add_comment", { id, body });
}

export function deleteTask(id: number): Promise<void> {
  return invoke("delete_task", { id });
}

export function updateTask(
  id: number,
  fields: {
    title?: string;
    description?: string;
    assignee?: string;
    priority?: string;
    estimatePoints?: number;
  },
): Promise<Task> {
  return invoke("update_task", { id, ...fields });
}

export function createProject(path: string, name: string, description: string): Promise<import("./types").Project> {
  return invoke("create_project", { path, name, description });
}

export function deleteProject(projectId: number): Promise<void> {
  return invoke("delete_project", { projectId });
}

export function getBriefing(projectId: number): Promise<Briefing> {
  return invoke("get_briefing", { projectId });
}

export function updateProjectContext(
  projectId: number,
  originalRequest: string,
  planSummary: string,
): Promise<Project> {
  return invoke("update_project_context", {
    projectId,
    originalRequest,
    planSummary,
  });
}

export function onBoardChanged(callback: () => void): Promise<UnlistenFn> {
  return listen("board-changed", callback);
}

// --- TargetProcess ---

export function tpGetSettings(): Promise<TpSettingsView> {
  return invoke("tp_get_settings");
}

export function tpSaveSettings(settings: TpSettings): Promise<TpSettingsView> {
  return invoke("tp_save_settings", { settings });
}

export function tpSetToken(token: string): Promise<TpSettingsView> {
  return invoke("tp_set_token", { token });
}

export function tpClearToken(): Promise<TpSettingsView> {
  return invoke("tp_clear_token");
}

export function tpTestConnection(): Promise<TpUser> {
  return invoke("tp_test_connection");
}

export function tpSearchUserStories(query: string): Promise<TpUserStory[]> {
  return invoke("tp_search_user_stories", { query });
}

/** `userStory` accepts an id or a pasted `…/entity/<id>` URL. */
export function tpLinkProject(projectId: number, userStory: string): Promise<Project> {
  return invoke("tp_link_project", { projectId, userStory });
}

export function tpUnlinkProject(projectId: number): Promise<Project> {
  return invoke("tp_unlink_project", { projectId });
}

/** Queue every not-yet-mirrored task; resolves to the number of operations queued. */
export function tpBackfillProject(projectId: number): Promise<number> {
  return invoke("tp_backfill_project", { projectId });
}

export function tpSyncNow(): Promise<SyncReport> {
  return invoke("tp_sync_now");
}

export function tpListQueue(): Promise<SyncQueueItem[]> {
  return invoke("tp_list_queue");
}

export function tpRetryQueueItem(id: number): Promise<void> {
  return invoke("tp_retry_queue_item", { id });
}

export function tpRetryAllQueueItems(): Promise<number> {
  return invoke("tp_retry_all_queue_items");
}

export function tpDismissQueueItem(id: number): Promise<void> {
  return invoke("tp_dismiss_queue_item", { id });
}

export interface ProjectAllDone {
  projectId: number;
  projectName: string;
}

export function onProjectAllDone(
  callback: (payload: ProjectAllDone) => void,
): Promise<UnlistenFn> {
  return listen<ProjectAllDone>("project-all-done", (event) => callback(event.payload));
}

// --- terminal ---

export interface PtyOutput {
  id: number;
  data: number[];
}

export function ptySpawn(cwd: string, cols: number, rows: number): Promise<number> {
  return invoke("pty_spawn", { cwd, cols, rows });
}

export function ptyWrite(id: number, data: string): Promise<void> {
  return invoke("pty_write", { id, data });
}

export function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { id, cols, rows });
}

export function ptyKill(id: number): Promise<void> {
  return invoke("pty_kill", { id });
}

export function onPtyOutput(callback: (output: PtyOutput) => void): Promise<UnlistenFn> {
  return listen<PtyOutput>("pty-output", (event) => callback(event.payload));
}

export function onPtyExit(callback: (id: number) => void): Promise<UnlistenFn> {
  return listen<{ id: number }>("pty-exit", (event) => callback(event.payload.id));
}
