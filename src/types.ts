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
}

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
}
