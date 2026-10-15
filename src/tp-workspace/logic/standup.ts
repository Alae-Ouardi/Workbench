// Daily standup summary from logged time and assigned work.

import { formatDay, previousWorkingDay } from "./dates";
import { formatHours, roundHours } from "./duration";
import { sum } from "./work";
import type { TpTimeEntry, TpWorkItem } from "../types";

export interface StandupLine {
  id: number | null;
  /** UserStory, Task or Bug ("" when unknown). */
  type: string;
  title: string;
  detail: string;
}

/** Prefix used in the copied summary to tell items apart. */
const TYPE_PREFIX: Record<string, string> = { UserStory: "US", Task: "Task", Bug: "Bug" };

export interface Standup {
  yesterdayDate: string;
  /** Closed or worked on during the previous working day. */
  yesterday: StandupLine[];
  yesterdayHours: number;
  /** My open stories, tasks and bugs in the current sprint. */
  inProgress: StandupLine[];
  todo: StandupLine[];
  blockers: StandupLine[];
}

/** Blocked states, whole words only ("Unblocked" or "Waiting for QA" are not). */
const BLOCKED_STATE = /\b(blocked|blocker|impeded|impediment|on hold)\b/i;
const BLOCKED_TAG = /block|imped|on hold|waiting/i;
/**
 * States that mean "not started" in common TargetProcess workflows. "Ready for
 * QA" and the like are not here: that work has been started.
 */
const NOT_STARTED = /^(open|new|backlog|planned|to ?do|ready|draft|not started|ready (for|to) (dev(elopment)?|start|work))$/i;

export function isBlocked(item: TpWorkItem): boolean {
  return BLOCKED_STATE.test(item.state.name) || item.tags.some((t) => BLOCKED_TAG.test(t));
}

export function isActive(item: TpWorkItem): boolean {
  return !item.state.is_final && !NOT_STARTED.test(item.state.name.trim()) && !isBlocked(item);
}

export interface DayLog {
  date: string;
  hours: number;
  lines: StandupLine[];
}

/** One line per entity, hours summed, descriptions kept in order. */
function linesFor(entries: TpTimeEntry[]): StandupLine[] {
  const byEntity = new Map<string, { id: number | null; type: string; title: string; hours: number; notes: string[] }>();
  for (const t of entries) {
    const key = t.entity_id !== null ? String(t.entity_id) : t.entity_name;
    const row = byEntity.get(key) ?? { id: t.entity_id, type: t.entity_type, title: t.entity_name || "Untitled", hours: 0, notes: [] };
    row.hours += t.spent;
    if (t.description.trim()) row.notes.push(t.description.trim());
    byEntity.set(key, row);
  }
  return [...byEntity.values()]
    .sort((a, b) => b.hours - a.hours)
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      detail: `${formatHours(r.hours)}${r.notes.length ? ` — ${r.notes.join("; ")}` : ""}`,
    }));
}

/**
 * What was done, day by day, newest first, for days in [from, to] that have
 * logged time. Today is always included (even empty) when in range.
 */
export function doneByDay(times: TpTimeEntry[], from: string, to: string, today: string): DayLog[] {
  const inRange = times.filter((t) => t.date >= from && t.date <= to);
  const dates = new Set(inRange.map((t) => t.date));
  if (today >= from && today <= to) dates.add(today);
  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const entries = inRange.filter((t) => t.date === date);
      return { date, hours: roundHours(sum(entries.map((t) => t.spent))), lines: linesFor(entries) };
    });
}

/** Work in a sprint that hasn't ended (older sprints are history). */
export function isCurrentSprintWork(item: TpWorkItem, today: string): boolean {
  return item.sprint_id !== null && (item.sprint_end_date === null || item.sprint_end_date >= today);
}

const byPriority = (a: TpWorkItem, b: TpWorkItem) => b.state.numeric_priority - a.state.numeric_priority;
const stateLine = (i: TpWorkItem): StandupLine => ({ id: i.id, type: i.entity_type, title: i.name, detail: i.state.name });

/**
 * Yesterday: what I closed or logged time on during the previous working day.
 * Today: my open stories, tasks and bugs in the current sprint.
 */
export function buildStandup(
  times: TpTimeEntry[],
  myWork: TpWorkItem[],
  closed: TpWorkItem[],
  today: string,
  workingDays: number[],
): Standup {
  const yesterdayDate = previousWorkingDay(today, workingDays);
  const logged = times.filter((t) => t.date === yesterdayDate);
  const closedThen = closed.filter((i) => i.state.is_final && i.end_date === yesterdayDate);
  const closedIds = new Set(closedThen.map((i) => i.id));

  const worked = linesFor(logged).map((l) =>
    l.id !== null && closedIds.has(l.id) ? { ...l, detail: `Closed · ${l.detail}` } : l,
  );
  const workedIds = new Set(worked.map((l) => l.id));
  const closedOnly = closedThen
    .filter((i) => !workedIds.has(i.id))
    .map((i) => ({ id: i.id, type: i.entity_type, title: i.name, detail: "Closed" }));

  const open = myWork.filter((i) => !i.state.is_final && isCurrentSprintWork(i, today));
  return {
    yesterdayDate,
    yesterdayHours: roundHours(sum(logged.map((t) => t.spent))),
    yesterday: [...closedOnly, ...worked],
    inProgress: open.filter(isActive).sort(byPriority).map(stateLine),
    todo: open.filter((i) => !isActive(i) && !isBlocked(i)).sort(byPriority).map(stateLine),
    blockers: open.filter(isBlocked).map(stateLine),
  };
}

function lines(list: StandupLine[], empty: string): string {
  if (!list.length) return `- ${empty}`;
  return list
    .map((l) => {
      const prefix = TYPE_PREFIX[l.type] ? `[${TYPE_PREFIX[l.type]}] ` : "";
      return `- ${prefix}${l.id !== null ? `#${l.id} ` : ""}${l.title} (${l.detail})`;
    })
    .join("\n");
}

export function standupText(s: Standup): string {
  return [
    `**Yesterday** (${formatDay(s.yesterdayDate)}, ${formatHours(s.yesterdayHours)} logged)`,
    lines(s.yesterday, "Nothing closed or logged"),
    "",
    "**In progress**",
    lines(s.inProgress, "Nothing in progress"),
    "",
    "**To do this sprint**",
    lines(s.todo, "Nothing left to start"),
    "",
    "**Blockers**",
    lines(s.blockers, "None"),
  ].join("\n");
}
