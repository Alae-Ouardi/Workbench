// Filtering, grouping and overdue rules for work items. "Done" always means
// the state's `is_final` flag, never a state name, because every TargetProcess
// process names its final states differently.

import { daysBetween } from "./dates";
import type { TpWorkItem, WorkspaceFilters } from "../types";

export function matchesText(item: TpWorkItem, text: string): boolean {
  const q = text.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  // A bare number is an id lookup; matching it inside names ("Sprint 133")
  // would bury the one item being looked for.
  if (/^\d+$/.test(q)) return String(item.id) === q;
  return [item.name, item.project_name, item.user_story_name, item.state.name, item.sprint_name, ...item.tags]
    .some((field) => field.toLowerCase().includes(q)) ||
    item.assigned.some((p) => p.name.toLowerCase().includes(q));
}

export function applyFilters(items: TpWorkItem[], filters: WorkspaceFilters): TpWorkItem[] {
  return items.filter(
    (item) =>
      (filters.projectIds.length === 0 ||
        (item.project_id !== null && filters.projectIds.includes(item.project_id))) &&
      (filters.assigneeId === null || item.assigned.some((p) => p.id === filters.assigneeId)) &&
      matchesText(item, filters.text),
  );
}

export interface OverdueInfo {
  item: TpWorkItem;
  /** The date it should have been finished by. */
  dueDate: string;
  daysLate: number;
  reason: "planned_end" | "sprint_ended";
}

/** Why and by how much an unfinished item is late, or `null` if it isn't. */
export function overdueInfo(item: TpWorkItem, today: string): OverdueInfo | null {
  if (item.state.is_final) return null;
  const candidates: Array<{ date: string; reason: OverdueInfo["reason"] }> = [];
  if (item.planned_end_date && item.planned_end_date < today) {
    candidates.push({ date: item.planned_end_date, reason: "planned_end" });
  }
  if (item.sprint_end_date && item.sprint_end_date < today) {
    candidates.push({ date: item.sprint_end_date, reason: "sprint_ended" });
  }
  if (candidates.length === 0) return null;
  // The earliest missed date is the honest measure of how late it is.
  const worst = candidates.reduce((a, b) => (a.date <= b.date ? a : b));
  return { item, dueDate: worst.date, daysLate: daysBetween(worst.date, today), reason: worst.reason };
}

export function overdueList(items: TpWorkItem[], today: string): OverdueInfo[] {
  return items
    .map((i) => overdueInfo(i, today))
    .filter((o): o is OverdueInfo => o !== null)
    .sort((a, b) => b.daysLate - a.daysLate || a.item.id - b.item.id);
}

export interface StateColumn {
  key: string;
  name: string;
  isFinal: boolean;
  items: TpWorkItem[];
}

/**
 * Board columns by state name, ordered like the workflow (numeric priority),
 * with final states always last. Processes share names like "In Progress", so
 * grouping by name merges the same step across projects.
 */
export function groupByState(items: TpWorkItem[]): StateColumn[] {
  const columns = new Map<string, StateColumn & { order: number }>();
  for (const item of items) {
    const key = item.state.name.toLowerCase() || "unknown";
    const column = columns.get(key);
    if (column) {
      column.items.push(item);
      column.order = Math.min(column.order, item.state.numeric_priority);
      column.isFinal = column.isFinal && item.state.is_final;
    } else {
      columns.set(key, {
        key,
        name: item.state.name || "Unknown",
        isFinal: item.state.is_final,
        order: item.state.numeric_priority,
        items: [item],
      });
    }
  }
  return [...columns.values()]
    .sort((a, b) => Number(a.isFinal) - Number(b.isFinal) || a.order - b.order || a.name.localeCompare(b.name))
    .map(({ order: _order, ...column }) => column);
}

export interface SprintKpis {
  total: number;
  done: number;
  effortTotal: number;
  effortDone: number;
  /** 0–100, by effort when there is any, otherwise by count. */
  progress: number;
  bugsOpen: number;
  unassigned: number;
}

export function sprintKpis(items: TpWorkItem[]): SprintKpis {
  const units = burndownUnits(items);
  const done = units.filter((i) => i.state.is_final);
  const effortTotal = sum(units.map((i) => i.effort));
  const effortDone = sum(done.map((i) => i.effort));
  const progress =
    effortTotal > 0 ? (effortDone / effortTotal) * 100 : units.length ? (done.length / units.length) * 100 : 0;
  return {
    total: units.length,
    done: done.length,
    effortTotal,
    effortDone,
    progress: Math.round(progress),
    bugsOpen: items.filter((i) => i.entity_type === "Bug" && !i.state.is_final).length,
    unassigned: items.filter((i) => !i.state.is_final && i.assigned.length === 0).length,
  };
}

/**
 * Items that carry the sprint's planned effort: stories, plus bugs that sit
 * outside a story. Tasks are excluded because a story's effort already rolls
 * its tasks up, and counting both would double the scope.
 */
export function burndownUnits(items: TpWorkItem[]): TpWorkItem[] {
  return items.filter(
    (i) => i.entity_type === "UserStory" || (i.entity_type === "Bug" && i.user_story_id === null),
  );
}

/** Tasks and bugs of a story, for the expandable story rows. */
export function childrenByStory(items: TpWorkItem[]): Map<number, TpWorkItem[]> {
  const map = new Map<number, TpWorkItem[]>();
  for (const item of items) {
    if (item.entity_type === "UserStory" || item.user_story_id === null) continue;
    const list = map.get(item.user_story_id) ?? [];
    list.push(item);
    map.set(item.user_story_id, list);
  }
  return map;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
