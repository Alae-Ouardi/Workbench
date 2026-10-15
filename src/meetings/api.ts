import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Holiday, LiveState, LoggedMeeting, MeetingSettings, Overview, PendingMeeting } from "./types";

export const meetingsApi = {
  overview: () => invoke<Overview>("meeting_overview"),
  split: () => invoke<void>("meeting_split"),
  stop: () => invoke<void>("meeting_stop"),
  log: (id: string, taskId: number, hours: number, description: string) =>
    invoke<LoggedMeeting>("meeting_log", { id, taskId, hours, description }),
  dismiss: (id: string) => invoke<void>("meeting_dismiss", { id }),
  settings: () => invoke<MeetingSettings>("meeting_settings_get"),
  saveSettings: (settings: MeetingSettings) => invoke<MeetingSettings>("meeting_settings_save", { settings }),
  holidays: (year: number) => invoke<{ fixed: Holiday[]; religious: Holiday[] }>("meeting_holidays", { year }),
  runRecurring: () => invoke<string[]>("meeting_run_recurring"),
};

export function onMeetingState(fn: (s: LiveState) => void): Promise<UnlistenFn> {
  return listen<LiveState>("meeting-state", (e) => fn(e.payload));
}

export function onMeetingsChanged(fn: (o: Overview) => void): Promise<UnlistenFn> {
  return listen<Overview>("meetings-changed", (e) => fn(e.payload));
}

export function onMeetingEnded(fn: (m: PendingMeeting) => void): Promise<UnlistenFn> {
  return listen<PendingMeeting>("meeting-ended", (e) => fn(e.payload));
}

/** Ask the main window to show the full logging popup for a meeting. */
export async function openPopupInMainWindow(id: string): Promise<void> {
  await invoke("show_main_window");
  await emit("meeting-open-popup", { id });
}

export function onOpenPopup(fn: (id: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string }>("meeting-open-popup", (e) => fn(e.payload.id));
}
