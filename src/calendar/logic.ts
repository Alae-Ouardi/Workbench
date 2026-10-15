// Pure helpers for the calendar views. Dates are local (the user's day).

import type { CalEvent } from "./types";

export const MINUTES_PER_DAY = 24 * 60;

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const day = d.getDay() === 0 ? 7 : d.getDay();
  return addDays(startOfDay(d), 1 - day);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Minutes since local midnight of `day`, clamped to the day. */
export function minutesInto(day: Date, iso: string): number {
  const m = (Date.parse(iso) - day.getTime()) / 60000;
  return Math.max(0, Math.min(MINUTES_PER_DAY, m));
}

export interface Placed {
  event: CalEvent;
  /** Minutes from midnight. */
  top: number;
  /** Minutes long (at least 15 so short events stay clickable). */
  height: number;
  column: number;
  columns: number;
}

/**
 * Timed events of one day laid out side by side where they overlap, like
 * Calendar does: each cluster of overlapping events shares its width.
 */
export function layoutDay(events: CalEvent[], day: Date): Placed[] {
  const dayEnd = addDays(day, 1).getTime();
  const timed = events
    .filter((e) => !e.all_day && Date.parse(e.start) < dayEnd && Date.parse(e.end) > day.getTime())
    .map((event) => {
      const top = minutesInto(day, event.start);
      const bottom = minutesInto(day, event.end);
      return { event, top, height: Math.max(15, bottom - top), column: 0, columns: 1 };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  const out: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = Math.max(1, ...cluster.map((p) => p.column + 1));
    cluster.forEach((p) => out.push({ ...p, columns }));
    cluster = [];
  };
  for (const p of timed) {
    if (cluster.length && p.top >= clusterEnd) flush();
    // First column whose last event has ended.
    const used = new Set(cluster.filter((c) => c.top + c.height > p.top).map((c) => c.column));
    let column = 0;
    while (used.has(column)) column++;
    cluster.push({ ...p, column });
    clusterEnd = Math.max(clusterEnd, p.top + p.height);
  }
  if (cluster.length) flush();
  return out;
}

/** All-day events touching `day`. */
export function allDayOn(events: CalEvent[], day: Date): CalEvent[] {
  const start = day.getTime();
  const end = addDays(day, 1).getTime();
  return events.filter((e) => e.all_day && Date.parse(e.start) < end && Date.parse(e.end) > start);
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "in 12 min", "in 2 h 5 min", "now", "ended". */
export function untilLabel(event: CalEvent, now: number): string {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (now >= end) return "ended";
  if (now >= start) return "now";
  const mins = Math.ceil((start - now) / 60000);
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `in ${h} h${m ? ` ${m} min` : ""}`;
}

/** The next meeting still to come (or in progress) today. */
export function nextMeeting(events: CalEvent[], now: number): CalEvent | undefined {
  return events
    .filter((e) => !e.all_day && Date.parse(e.end) > now && e.my_status !== "declined")
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
}
