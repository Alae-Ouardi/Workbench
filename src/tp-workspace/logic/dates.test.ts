import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  eachDay,
  formatDay,
  isoWeekday,
  monthGrid,
  previousWorkingDay,
  shiftMonth,
  startOfWeek,
  todayIso,
} from "./dates";

describe("dates", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("does not drift across DST changes", () => {
    // Europe moves clocks on 2026-03-29; UTC maths must ignore it.
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("uses Monday-first ISO weekdays", () => {
    expect(isoWeekday("2026-10-12")).toBe(1); // Monday
    expect(isoWeekday("2026-10-18")).toBe(7); // Sunday
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12");
  });

  it("lists every day of a range inclusively", () => {
    expect(eachDay("2026-10-12", "2026-10-14")).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(eachDay("2026-10-14", "2026-10-12")).toEqual([]);
  });

  it("builds a month grid of full Monday-first weeks", () => {
    const grid = monthGrid("2026-10-12");
    expect(grid[0][0]).toBe("2026-09-28");
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(grid.flat()).toContain("2026-10-31");
    expect(grid[grid.length - 1][6] >= "2026-10-31").toBe(true);
  });

  it("shifts months from the first day", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("finds the previous working day over a weekend", () => {
    expect(previousWorkingDay("2026-10-12", [1, 2, 3, 4, 5])).toBe("2026-10-09");
    expect(previousWorkingDay("2026-10-14", [1, 2, 3, 4, 5])).toBe("2026-10-13");
    // An empty set falls back to Mon–Fri instead of looping forever.
    expect(previousWorkingDay("2026-10-12", [])).toBe("2026-10-09");
  });

  it("formats days and reads the local today", () => {
    expect(formatDay("2026-10-12")).toBe("Mon 12 Oct");
    expect(todayIso(new Date(2026, 9, 12, 23, 59))).toBe("2026-10-12");
  });
});
