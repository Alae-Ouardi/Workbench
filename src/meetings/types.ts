// Mirrors src-tauri/src/meetings.

export interface LiveState {
  active: boolean;
  started_at: string | null;
  apps: string[];
  suppressed: boolean;
}

export interface PendingMeeting {
  id: string;
  start: string;
  end: string;
  apps: string[];
  /** The scheduled calendar event this call matched. */
  title: string | null;
}

export interface LoggedMeeting {
  id: string;
  start: string;
  end: string;
  hours: number;
  task_id: number;
  description: string;
  time_id: number;
  kind: "meeting" | "recurring";
}

export interface Overview {
  live: LiveState;
  pending: PendingMeeting[];
  logged: LoggedMeeting[];
}

export interface Shortcut {
  id: string;
  name: string;
  task_id: number;
  description: string;
}

export interface RecurringEntry {
  id: string;
  label: string;
  task_id: number;
  hours: number;
}

export interface HolidayChoice {
  key: string;
  date: string;
  on: boolean;
}

export interface MeetingSettings {
  enabled: boolean;
  daily_task_id: number;
  meetings_task_id: number;
  min_minutes: number;
  step_minutes: number;
  shortcuts: Shortcut[];
  recurring: RecurringEntry[];
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekly_off: number[];
  days_off: string[];
  region: "none" | "morocco";
  holiday_choices: HolidayChoice[];
  imported: boolean;
  /** Minutes before a scheduled meeting to notify; 0 = off. */
  reminder_minutes: number;
}

export interface Holiday {
  date: string;
  name: string;
  key: string | null;
}
