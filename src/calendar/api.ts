import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Access, CalEvent } from "./types";

export const calendarApi = {
  access: () => invoke<Access>("calendar_access"),
  requestAccess: () => invoke<Access>("calendar_request_access"),
  events: (from: Date, to: Date) => invoke<CalEvent[]>("calendar_events", { from: from.toISOString(), to: to.toISOString() }),
};

export function join(event: CalEvent): void {
  if (event.join_url) openUrl(event.join_url).catch((e) => console.error("could not open the meeting link", e));
}

/** Opens the Calendar privacy pane, where access can be granted after a refusal. */
export function openCalendarPrivacy(): void {
  openUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars").catch(() => {});
}
