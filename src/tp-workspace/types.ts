// Mirrors of the Rust structs in `taskboard-core/src/tp/read.rs` and
// `prefs.rs`. Dates are `YYYY-MM-DD` strings in the TargetProcess timezone.

export type EntityType = "UserStory" | "Task" | "Bug";

export interface TpProject {
  id: number;
  name: string;
  abbreviation: string;
  process_id: number | null;
}

export interface TpSprint {
  id: number;
  name: string;
  start_date: string | null;
  end_date: string | null;
  team_id: number | null;
  team_name: string;
}

export interface TpStateRef {
  id: number;
  name: string;
  is_final: boolean;
  numeric_priority: number;
}

export interface TpEntityState {
  id: number;
  name: string;
  is_final: boolean;
  numeric_priority: number;
}

export interface TpPerson {
  id: number;
  name: string;
}

export interface TpWorkItem {
  id: number;
  entity_type: EntityType;
  name: string;
  state: TpStateRef;
  project_id: number | null;
  project_name: string;
  process_id: number | null;
  team_name: string;
  sprint_id: number | null;
  sprint_name: string;
  sprint_end_date: string | null;
  user_story_id: number | null;
  user_story_name: string;
  effort: number;
  effort_completed: number;
  effort_to_do: number;
  time_spent: number;
  time_remain: number;
  planned_end_date: string | null;
  end_date: string | null;
  start_date: string | null;
  modify_date: string | null;
  assigned: TpPerson[];
  tags: string[];
}

export interface TpTimeEntry {
  id: number;
  date: string;
  spent: number;
  remain: number;
  description: string;
  entity_id: number | null;
  entity_type: string;
  entity_name: string;
  project_id: number | null;
  project_name: string;
}

export interface WorkspacePrefs {
  default_project_ids: number[];
  project_colors: Record<string, string>;
  refresh_minutes: number;
  daily_target_hours: number;
  weekly_target_hours: number;
  /** `null` = derived from the weekly target and the month's working days. */
  monthly_target_hours: number | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  working_days: number[];
  theme: "dark" | "light" | "system";
}

export type TpwQuery =
  | { kind: "projects" }
  | { kind: "sprints"; project_ids: number[] }
  | { kind: "sprint_items"; sprint_id: number }
  | { kind: "my_work" }
  | { kind: "my_closed"; since: string }
  | { kind: "overdue"; project_ids: number[] }
  | { kind: "times"; from: string; to: string };

export interface TpwResult<T> {
  payload: T;
  fetched_at: string;
  from_cache: boolean;
}

export interface WorkspaceFilters {
  projectIds: number[];
  /** `null` = everyone. */
  assigneeId: number | null;
  text: string;
}
