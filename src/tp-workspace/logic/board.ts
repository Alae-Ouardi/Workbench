// Ordering inside a board column, shared by the Dashboard and My Work.

import { daysBetween } from "./dates";
import { isBlocked } from "./standup";
import { overdueInfo, type StateColumn } from "./work";
import type { TpWorkItem } from "../types";

/** Lower sorts first: stories before tasks, then blocked, late, due soonest. */
export function boardRank(item: TpWorkItem, today: string): number {
  const level = item.entity_type === "UserStory" ? 0 : 1_000_000;
  if (isBlocked(item)) return level - 100_000;
  const late = overdueInfo(item, today);
  if (late) return level - 10_000 - late.daysLate;
  return level + (item.planned_end_date ? daysBetween(today, item.planned_end_date) : 10_000);
}

export function sortColumns(columns: StateColumn[], today: string): StateColumn[] {
  return columns.map((col) => ({
    ...col,
    items: [...col.items].sort((a, b) => boardRank(a, today) - boardRank(b, today) || a.id - b.id),
  }));
}

/**
 * Keep every workflow state of `reference` as a column, empty or not, in the
 * reference order. Filtering then never collapses the board to a single
 * stretched column, and columns stay put as filters change.
 */
export function alignColumns(columns: StateColumn[], reference: StateColumn[]): StateColumn[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const aligned = reference.map((ref) => byKey.get(ref.key) ?? { ...ref, items: [] });
  const extra = columns.filter((c) => !reference.some((r) => r.key === c.key));
  return [...aligned, ...extra];
}
