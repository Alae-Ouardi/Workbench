import { describe, expect, it } from "vitest";
import { computeBurndown } from "./burndown";
import { DONE, IN_PROGRESS, item, time } from "./fixtures";
import { buildStandup, doneByDay, isActive, isBlocked, isCurrentSprintWork, standupText } from "./standup";
import type { TpSprint } from "../types";

const SPRINT: TpSprint = {
  id: 133,
  name: "Sprint 133",
  start_date: "2026-10-05",
  end_date: "2026-10-09",
  team_id: 1,
  team_name: "Core",
};

describe("burndown", () => {
  it("burns effort on the day items reached a final state", () => {
    const b = computeBurndown(
      [
        item({ id: 1, effort: 6, state: DONE, end_date: "2026-10-06" }),
        item({ id: 2, effort: 4 }),
        item({ id: 3, entity_type: "Task", user_story_id: 2, effort: 4, state: DONE, end_date: "2026-10-05" }),
      ],
      SPRINT,
      "2026-10-07",
    )!;
    expect(b.unit).toBe("effort");
    expect(b.total).toBe(10);
    expect(b.points.map((p) => p.remaining)).toEqual([10, 4, 4, null, null]);
    expect(b.points.map((p) => p.ideal)).toEqual([10, 7.5, 5, 2.5, 0]);
  });

  it("counts items when nothing is estimated", () => {
    const b = computeBurndown([item({ id: 1, state: DONE, end_date: "2026-10-05" }), item({ id: 2 })], SPRINT, "2026-10-20")!;
    expect(b.unit).toBe("items");
    expect(b.points[0].remaining).toBe(1);
  });

  it("needs sprint dates", () => {
    expect(computeBurndown([], { ...SPRINT, end_date: null }, "2026-10-07")).toBeNull();
  });
});

describe("standup", () => {
  const CURRENT = { sprint_id: 134, sprint_end_date: "2026-10-16" };
  const OLD = { sprint_id: 120, sprint_end_date: "2026-05-01" };
  const work = [
    item({ id: 1, entity_type: "Task", name: "Login form", state: IN_PROGRESS, ...CURRENT }),
    item({ id: 2, entity_type: "Bug", name: "Invoice export", state: { ...IN_PROGRESS, name: "Blocked" }, ...CURRENT }),
    item({ id: 3, entity_type: "Task", name: "Search", tags: ["waiting-on-api"], ...CURRENT }),
    item({ id: 4, entity_type: "Task", name: "Next task", ...CURRENT }),
    item({ id: 5, entity_type: "Task", name: "Old sprint leftover", state: IN_PROGRESS, ...OLD }),
    item({ id: 6, entity_type: "Task", name: "No sprint", state: IN_PROGRESS, sprint_id: null }),
    item({ id: 7, entity_type: "UserStory", name: "A story", state: IN_PROGRESS, ...CURRENT }),
    item({ id: 12, entity_type: "UserStory", name: "Ready story", state: { ...IN_PROGRESS, name: "Ready for development" }, ...CURRENT }),
    item({ id: 13, entity_type: "UserStory", name: "In test", state: { ...IN_PROGRESS, name: "Ready for QA" }, ...CURRENT }),
  ];
  const closed = [
    item({ id: 8, entity_type: "Bug", name: "Fixed bug", state: DONE, end_date: "2026-10-09" }),
    item({ id: 9, entity_type: "Task", name: "Closed earlier", state: DONE, end_date: "2026-10-07" }),
    item({ id: 1, entity_type: "Task", name: "Login form", state: DONE, end_date: "2026-10-09" }),
  ];
  const times = [
    time({ id: 1, date: "2026-10-09", spent: 2, description: "form layout", entity_id: 1, entity_name: "Login form" }),
    time({ id: 2, date: "2026-10-09", spent: 1.5, entity_id: 11, entity_type: "UserStory", entity_name: "Old story" }),
    time({ id: 3, date: "2026-10-08", spent: 4 }),
  ];

  it("classifies active and blocked work", () => {
    expect(isActive(work[0])).toBe(true);
    expect(isBlocked(work[1])).toBe(true);
    expect(isBlocked(work[2])).toBe(true);
    expect(isActive(work[3])).toBe(false);
    expect(isBlocked({ ...work[0], state: { ...work[0].state, name: "Unblocked" } })).toBe(false);
    expect(isBlocked({ ...work[0], state: { ...work[0].state, name: "Waiting for QA" } })).toBe(false);
    expect(isBlocked({ ...work[0], state: { ...work[0].state, name: "On hold" } })).toBe(true);
  });

  it("only counts work in a sprint that hasn't ended", () => {
    const today = "2026-10-12";
    expect(work.filter((i) => isCurrentSprintWork(i, today)).map((i) => i.id)).toEqual([1, 2, 3, 4, 7, 12, 13]);
  });

  it("lists what was closed or logged on the previous working day", () => {
    const s = buildStandup(times, work, closed, "2026-10-12", [1, 2, 3, 4, 5]);
    expect(s.yesterdayDate).toBe("2026-10-09");
    expect(s.yesterdayHours).toBe(3.5);
    expect(s.yesterday).toEqual([
      { id: 8, type: "Bug", title: "Fixed bug", detail: "Closed" },
      { id: 1, type: "Task", title: "Login form", detail: "Closed · 2h — form layout" },
      { id: 11, type: "UserStory", title: "Old story", detail: "1h 30m" },
    ]);
  });

  it("splits current sprint work into in progress, to do and blockers", () => {
    const s = buildStandup(times, work, closed, "2026-10-12", [1, 2, 3, 4, 5]);
    expect(s.inProgress.map((l) => l.id)).toEqual([1, 7, 13]);
    expect(s.todo.map((l) => l.id)).toEqual([12, 4]);
    expect(s.blockers.map((l) => l.id)).toEqual([2, 3]);
    const text = standupText(s);
    expect(text).toContain("**Yesterday** (Fri 9 Oct, 3h 30m logged)");
    expect(text).toContain("- [Task] #1 Login form (In Progress)");
    expect(text).toContain("- [Bug] #2 Invoice export (Blocked)");
    expect(text).toContain("**To do this sprint**");
    expect(text).not.toContain("Old sprint leftover");
  });

  it("says so when there is nothing to report", () => {
    const text = standupText(buildStandup([], [], [], "2026-10-12", [1, 2, 3, 4, 5]));
    expect(text).toContain("- Nothing closed or logged");
    expect(text).toContain("- Nothing in progress");
  });
});

describe("standup history", () => {
  const entries = [
    time({ id: 1, date: "2026-10-12", spent: 1, entity_id: 7, entity_name: "Today task" }),
    time({ id: 2, date: "2026-10-09", spent: 2, entity_id: 8, entity_name: "Friday task", description: "review" }),
    time({ id: 3, date: "2026-10-09", spent: 3, entity_id: 9, entity_name: "Bigger" }),
    time({ id: 4, date: "2026-09-01", spent: 1 }),
  ];

  it("lists days newest first with the biggest work first", () => {
    const days = doneByDay(entries, "2026-10-01", "2026-10-12", "2026-10-12");
    expect(days.map((d) => d.date)).toEqual(["2026-10-12", "2026-10-09"]);
    expect(days[1].hours).toBe(5);
    expect(days[1].lines.map((l) => l.title)).toEqual(["Bigger", "Friday task"]);
    expect(days[1].lines[1].detail).toContain("review");
  });

  it("keeps today even without logged time, and honours the range", () => {
    expect(doneByDay([], "2026-10-12", "2026-10-12", "2026-10-12")).toEqual([{ date: "2026-10-12", hours: 0, lines: [] }]);
    expect(doneByDay(entries, "2026-09-01", "2026-09-01", "2026-10-12").map((d) => d.date)).toEqual(["2026-09-01"]);
  });
});
