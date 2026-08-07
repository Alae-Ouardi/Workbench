export type Status = "open" | "waiting" | "in_progress" | "review" | "done";
export type Kind = "task" | "bug";
export type Priority = "low" | "normal" | "high" | "urgent";

export const STATUSES: Status[] = ["open", "waiting", "in_progress", "review", "done"];

export const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  waiting: "Waiting",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export interface Project {
  id: number;
  name: string;
  path: string;
  created_at: string;
  original_request: string;
  plan_summary: string;
  last_actor: string;
  last_session_id: string;
  handoff_note: string;
  current_task_id: number | null;
  handoff_updated_at: string | null;
  /** TargetProcess user story this project's tasks are mirrored under. */
  tp_user_story_id: number | null;
  tp_user_story_name: string;
  tp_project_id: number | null;
  tp_process_id: number | null;
  /** Team of the linked story, copied onto mirrored entities. */
  tp_team_id: number | null;
  /** Sprint of the linked story, copied onto mirrored entities. */
  tp_team_iteration_id: number | null;
  tp_sync_enabled: boolean;
}

export interface ProjectSummary extends Project {
  open: number;
  waiting: number;
  in_progress: number;
  review: number;
  done: number;
}

export interface Task {
  id: number;
  project_id: number;
  project_name: string;
  title: string;
  description: string;
  status: Status;
  kind: Kind;
  assignee: string;
  priority: Priority;
  position: number;
  created_at: string;
  updated_at: string;
  /** Id of the mirrored TargetProcess entity, once it has been created. */
  tp_entity_id: number | null;
  /** TargetProcess entity type: "Task" or "Bug". */
  tp_entity_type: string;
  /** Simulated human effort in points, where 1 point = 1 hour. */
  estimate_points: number;
  tp_sync_state: TpSyncState;
  tp_sync_error: string;
  /** Hours already logged to TargetProcess; guards against double-logging. */
  tp_time_logged: number;
}

export type TpSyncState = "none" | "pending" | "synced" | "error";

export interface Comment {
  id: number;
  task_id: number;
  author: string;
  body: string;
  created_at: string;
}

export interface TaskEvent {
  id: number;
  task_id: number;
  actor: string;
  kind: string;
  detail: string;
  created_at: string;
}

export interface TaskRef {
  id: number;
  title: string;
  status: Status;
}

export interface TaskDetail extends Task {
  depends_on: TaskRef[];
  blocks: TaskRef[];
  comments: Comment[];
  events: TaskEvent[];
}

export interface StatusChange {
  task: Task;
  promoted: Task[];
}

export interface Briefing {
  project: Project;
  resume_task: Task | null;
  tasks: Task[];
}

export interface NewTaskInput {
  projectId: number;
  title: string;
  description: string;
  kind: Kind;
  priority: Priority;
  assignee: string;
  estimatePoints: number;
}

// ---------------------------------------------------------------- TargetProcess

/** Non-secret TargetProcess settings, as stored in ~/.taskboard/config.json. */
export interface TpSettings {
  base_url: string;
  enabled: boolean;
  /** Minutes east of UTC (opposite sign to JS getTimezoneOffset). */
  tz_offset_minutes: number;
  done_state_name: string;
  /** Empty means "don't sync this transition". */
  in_progress_state_name: string;
  review_state_name: string;
  cached_user_id: number | null;
  cached_user_name: string;
}

/** Settings plus derived fields. The token itself is never sent to the UI. */
export interface TpSettingsView extends TpSettings {
  token_set: boolean;
  base_url_normalized: string;
}

export interface TpUser {
  id: number;
  name: string;
  email: string;
}

export interface TpUserStory {
  id: number;
  name: string;
  state_name: string;
  project_id: number | null;
  project_name: string;
  process_id: number | null;
}

export interface SyncQueueItem {
  id: number;
  kind: "create_entity" | "set_state" | "log_time";
  /** Human-readable label for `kind`. */
  label: string;
  project_id: number;
  task_id: number | null;
  task_title: string;
  attempts: number;
  last_error: string;
  next_attempt_at: string;
  created_at: string;
  /** Automatic retries are exhausted; only a manual retry will move it. */
  exhausted: boolean;
}

export interface SyncReport {
  processed: number;
  succeeded: number;
  failed: number;
  dropped: number;
  pending: number;
  error: string | null;
}

/** Format an effort estimate in points for display, where 1 point = 1 hour. */
export function formatEstimate(points: number): string {
  if (points <= 0) return "";
  if (points < 1) return `${Math.round(points * 60)}m`;
  return Number.isInteger(points) ? `${points}h` : `${points}h`;
}
