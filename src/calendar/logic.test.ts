import { describe, expect, it } from "vitest";
import { allDayOn, layoutDay, nextMeeting, startOfWeek, untilLabel } from "./logic";
import type { CalEvent } from "./types";

const day = new Date(2026, 9, 13); // Tue 13 Oct, local midnight
const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).toISOString();

function ev(id: string, start: string, end: string, extra: Partial<CalEvent> = {}): CalEvent {
  return {
    id, title: id, start, end, all_day: false,
    calendar: { id: "c", title: "Work", color: "#22d3ee" },
    location: null, notes: null, url: null, join_url: null, organizer: null, attendees: [], my_status: null,
    ...extra,
  };
}

describe("calendar layout", () => {
  it("places events by time and splits overlaps into columns", () => {
    const placed = layoutDay(
      [ev("a", at(9), at(10)), ev("b", at(9, 30), at(10, 30)), ev("c", at(11), at(11, 5))],
      day,
    );
    const byId = Object.fromEntries(placed.map((p) => [p.event.id, p]));
    expect(byId.a.top).toBe(540);
    expect([byId.a.column, byId.b.column]).toEqual([0, 1]);
    expect(byId.a.columns).toBe(2);
    expect(byId.c.columns).toBe(1);
    expect(byId.c.height).toBe(15);
  });

  it("clips events running past midnight to the day", () => {
    const [p] = layoutDay([ev("late", at(23), new Date(2026, 9, 14, 1).toISOString())], day);
    expect(p.top + p.height).toBe(24 * 60);
  });

  it("keeps all-day events out of the grid", () => {
    const holiday = ev("holiday", at(0), new Date(2026, 9, 14).toISOString(), { all_day: true });
    expect(layoutDay([holiday], day)).toHaveLength(0);
    expect(allDayOn([holiday], day).map((e) => e.id)).toEqual(["holiday"]);
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeek(day).getDate()).toBe(12);
    expect(startOfWeek(new Date(2026, 9, 18)).getDate()).toBe(12); // Sunday
  });
});

describe("next meeting", () => {
  const events = [ev("past", at(8), at(9)), ev("declined", at(9, 30), at(10), { my_status: "declined" }), ev("review", at(10), at(11))];
  it("skips finished and declined meetings", () => {
    const now = Date.parse(at(9, 45));
    expect(nextMeeting(events, now)?.id).toBe("review");
    expect(untilLabel(events[2], now)).toBe("in 15 min");
    expect(untilLabel(events[2], Date.parse(at(10, 30)))).toBe("now");
    expect(untilLabel(events[2], Date.parse(at(7, 50)))).toBe("in 2 h 10 min");
  });
});
