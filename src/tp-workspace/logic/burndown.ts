// Sprint burndown, reconstructed from the current state of the sprint.
//
// TargetProcess's REST API has no history of remaining effort, so each day's
// remaining work is the sprint's scope minus the effort of items that had
// reached a final state by that day (their `end_date`). Scope added mid-sprint
// therefore appears from day one — the chart says so in its legend.

import { eachDay } from "./dates";
import { burndownUnits, round1, sum } from "./work";
import type { TpSprint, TpWorkItem } from "../types";

export interface BurndownPoint {
  date: string;
  ideal: number;
  /** `null` for days that have not happened yet. */
  remaining: number | null;
}

export interface Burndown {
  points: BurndownPoint[];
  total: number;
  /** Effort points, or item count when nothing in the sprint is estimated. */
  unit: "effort" | "items";
}

export function computeBurndown(items: TpWorkItem[], sprint: TpSprint, today: string): Burndown | null {
  if (!sprint.start_date || !sprint.end_date || sprint.end_date < sprint.start_date) return null;
  const units = burndownUnits(items);
  const estimated = sum(units.map((u) => u.effort)) > 0;
  const weight = (u: TpWorkItem) => (estimated ? u.effort : 1);
  const total = round1(sum(units.map(weight)));
  const days = eachDay(sprint.start_date, sprint.end_date);
  const span = Math.max(days.length - 1, 1);

  const points = days.map((date, index) => {
    const burned = sum(
      units.filter((u) => u.state.is_final && u.end_date !== null && u.end_date <= date).map(weight),
    );
    return {
      date,
      ideal: round1(total - (total * index) / span),
      remaining: date <= today ? round1(total - burned) : null,
    };
  });
  return { points, total, unit: estimated ? "effort" : "items" };
}
