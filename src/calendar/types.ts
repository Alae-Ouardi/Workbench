// Mirrors src-tauri/src/calendar.

export interface CalendarInfo {
  id: string;
  title: string;
  color: string;
}

export interface Attendee {
  name: string;
  email: string | null;
  status: string;
  is_me: boolean;
}

export interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  calendar: CalendarInfo;
  location: string | null;
  notes: string | null;
  url: string | null;
  join_url: string | null;
  organizer: string | null;
  attendees: Attendee[];
  my_status: string | null;
}

export type Access = "not_determined" | "denied" | "restricted" | "granted";
