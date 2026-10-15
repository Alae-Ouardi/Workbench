import { describe, expect, it } from "vitest";
import { time } from "./fixtures";
import { byProject, dayStatus, gapDays, groupByDay, monthTarget, totalFor, weekTotal } from "./timesheet";

const RULES = { dailyTargetHours: 8, workingDays: [1, 2, 3, 4, 5] };
const TODAY = "2026-10-14"; // Wednesday

describe("timesheet", () => {
  const entries = [
    time({ id: 1, date: "2026-10-12", spent: 5 }),
    time({ id: 2, date: "2026-10-12", spent: 3.5, project_name: "ILS" }),
    time({ id: 3, date: "2026-10-13", spent: 2.25 }),
    time({ id: 4, date: "2026-10-14", spent: 1 }),
    time({ id: 5, date: "", spent: 9 }),
  ];
  const days = groupByDay(entries);

  it("sums hours per TP calendar day to the minute and skips undated entries", () => {
    expect(days.get("2026-10-12")!.total).toBe(8.5);
    expect(days.get("2026-10-12")!.entries).toHaveLength(2);
    // 2.25 is 2h 15m — it must not be rounded to 2.3.
    expect(days.get("2026-10-13")!.total).toBe(2.25);
    expect(days.has("")).toBe(false);
  });

  it("classifies days against the target", () => {
    expect(dayStatus("2026-10-12", 8, TODAY, RULES)).toBe("met");
    expect(dayStatus("2026-10-12", 7.75, TODAY, RULES)).toBe("short");
    expect(dayStatus("2026-10-13", 2.25, TODAY, RULES)).toBe("short");
    expect(dayStatus(TODAY, 0, TODAY, RULES)).toBe("empty");
    expect(dayStatus(TODAY, 1, TODAY, RULES)).toBe("short");
    expect(dayStatus("2026-10-15", 0, TODAY, RULES)).toBe("future");
    expect(dayStatus("2026-10-11", 0, TODAY, RULES)).toBe("off"); // Sunday
    expect(dayStatus("2026-10-11", 2, TODAY, RULES)).toBe("met");
  });

  it("lists past working days under target, excluding today", () => {
    const gaps = gapDays(days, "2026-10-08", "2026-10-31", TODAY, RULES);
    expect(gaps.map((g) => g.date)).toEqual(["2026-10-08", "2026-10-09", "2026-10-13"]);
    expect(gaps[gaps.length - 1].missing).toBe(5.75);
  });

  it("totals a Monday-first week and any set of days", () => {
    expect(weekTotal(days, "2026-10-18")).toBe(11.75);
    expect(totalFor(days, ["2026-10-12", "2026-10-13"])).toBe(10.75);
  });

  it("derives the month target from the weekly target and working days", () => {
    // October 2026 has 22 weekdays: 40 × 22 / 5 = 176h.
    expect(monthTarget("2026-10-12", 40, [1, 2, 3, 4, 5], null)).toBe(176);
    expect(monthTarget("2026-10-12", 40, [1, 2, 3, 4, 5], 180)).toBe(180);
    // February 2026 has 20 weekdays.
    expect(monthTarget("2026-02-01", 40, [1, 2, 3, 4, 5], null)).toBe(160);
    // A 4-day week spreads the same 40h over fewer days.
    expect(monthTarget("2026-10-12", 40, [1, 2, 3, 4], null)).toBe(170); // 17 Mon–Thu days
  });

  it("breaks hours down by project", () => {
    expect(byProject(entries.slice(0, 2))).toEqual([
      { name: "Evo", hours: 5 },
      { name: "ILS", hours: 3.5 },
    ]);
  });
});
