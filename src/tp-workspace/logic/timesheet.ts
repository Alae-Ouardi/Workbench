// Time-calendar maths: hours per day, week and month against their targets,
// and which working days fell short. Hours are decimal (0.5 = 30 minutes) and
// rounded to the minute.

import { addDays, eachDay, isoWeekday, startOfWeek } from "./dates";
import { roundHours } from "./duration";
import { sum } from "./work";
import type { TpTimeEntry } from "../types";

export interface DayLog {
  date: string;
  total: number;
  entries: TpTimeEntry[];
}

export type DayStatus = "future" | "off" | "met" | "short" | "empty";

export function groupByDay(entries: TpTimeEntry[]): Map<string, DayLog> {
  const days = new Map<string, DayLog>();
  for (const entry of entries) {
    if (!entry.date) continue;
    const day = days.get(entry.date) ?? { date: entry.date, total: 0, entries: [] };
    day.entries.push(entry);
    day.total = roundHours(day.total + entry.spent);
    days.set(entry.date, day);
  }
  return days;
}

export interface TargetRules {
  dailyTargetHours: number;
  workingDays: number[];
}

/**
 * How a day measures against the target. Today counts as "short" only once it
 * is over, so the current day is shown as in progress rather than flagged.
 */
export function dayStatus(date: string, total: number, today: string, rules: TargetRules): DayStatus {
  if (date > today) return "future";
  const working = rules.workingDays.includes(isoWeekday(date));
  if (!working) return total > 0 ? "met" : "off";
  if (total >= rules.dailyTargetHours - 1e-9) return "met";
  if (date === today) return total > 0 ? "short" : "empty";
  return "short";
}

/** Past working days below target, with how many hours are missing. */
export function gapDays(
  days: Map<string, DayLog>,
  from: string,
  to: string,
  today: string,
  rules: TargetRules,
): Array<{ date: string; logged: number; missing: number }> {
  const end = to < today ? to : today;
  return eachDay(from, end)
    .filter((d) => d < today && rules.workingDays.includes(isoWeekday(d)))
    .map((d) => ({ date: d, logged: days.get(d)?.total ?? 0 }))
    .filter((d) => d.logged < rules.dailyTargetHours - 1e-9)
    .map((d) => ({ ...d, missing: roundHours(rules.dailyTargetHours - d.logged) }));
}

export function weekTotal(days: Map<string, DayLog>, anyDayOfWeek: string): number {
  const start = startOfWeek(anyDayOfWeek);
  return roundHours(sum(eachDay(start, addDays(start, 6)).map((d) => days.get(d)?.total ?? 0)));
}

/** Total logged over a list of days. */
export function totalFor(days: Map<string, DayLog>, dates: string[]): number {
  return roundHours(sum(dates.map((d) => days.get(d)?.total ?? 0)));
}

/**
 * The month's target: the configured one, or the weekly target spread over
 * the month's working days (40h/week over 22 working days of a 5-day week
 * gives 176h).
 */
export function monthTarget(
  anyDayOfMonth: string,
  weeklyTarget: number,
  workingDays: number[],
  override: number | null,
): number {
  if (override !== null && override > 0) return override;
  const days = workingDays.length ? workingDays : [1, 2, 3, 4, 5];
  const first = `${anyDayOfMonth.slice(0, 7)}-01`;
  const inMonth = eachDay(first, addDays(first, 30)).filter((d) => d.slice(0, 7) === first.slice(0, 7));
  const working = inMonth.filter((d) => days.includes(isoWeekday(d))).length;
  return roundHours((weeklyTarget * working) / days.length);
}

/** Hours by project for a set of entries, largest first. */
export function byProject(entries: TpTimeEntry[]): Array<{ name: string; hours: number }> {
  const map = new Map<string, number>();
  for (const e of entries) {
    const name = e.project_name || "No project";
    map.set(name, (map.get(name) ?? 0) + e.spent);
  }
  return [...map.entries()]
    .map(([name, hours]) => ({ name, hours: roundHours(hours) }))
    .sort((a, b) => b.hours - a.hours);
}
