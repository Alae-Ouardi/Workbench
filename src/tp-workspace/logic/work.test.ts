import { describe, expect, it } from "vitest";
import { DONE, IN_PROGRESS, item } from "./fixtures";
import {
  applyFilters,
  burndownUnits,
  childrenByStory,
  groupByState,
  overdueInfo,
  overdueList,
  sprintKpis,
} from "./work";

const TODAY = "2026-10-12";

describe("filters", () => {
  const items = [
    item({ id: 1, name: "Login form", project_id: 3, assigned: [{ id: 7, name: "Sam Lee" }] }),
    item({ id: 2, name: "Invoice export", project_id: 4, project_name: "ILS", tags: ["billing"] }),
  ];

  it("keeps everything with empty filters", () => {
    expect(applyFilters(items, { projectIds: [], assigneeId: null, text: "" })).toHaveLength(2);
  });

  it("filters by project, assignee and text", () => {
    expect(applyFilters(items, { projectIds: [4], assigneeId: null, text: "" }).map((i) => i.id)).toEqual([2]);
    expect(applyFilters(items, { projectIds: [], assigneeId: 7, text: "" }).map((i) => i.id)).toEqual([1]);
    expect(applyFilters(items, { projectIds: [], assigneeId: null, text: "BILLING" }).map((i) => i.id)).toEqual([2]);
    expect(applyFilters(items, { projectIds: [], assigneeId: null, text: "sam" }).map((i) => i.id)).toEqual([1]);
  });

  it("matches an exact id with or without a hash", () => {
    expect(applyFilters(items, { projectIds: [], assigneeId: null, text: "#2" }).map((i) => i.id)).toEqual([2]);
    expect(applyFilters(items, { projectIds: [], assigneeId: null, text: "1" }).map((i) => i.id)).toEqual([1]);
  });
});

describe("overdue", () => {
  it("never reports finished items", () => {
    expect(overdueInfo(item({ id: 1, state: DONE, planned_end_date: "2026-01-01" }), TODAY)).toBeNull();
  });

  it("is not overdue on the due day itself", () => {
    expect(overdueInfo(item({ id: 1, planned_end_date: TODAY }), TODAY)).toBeNull();
  });

  it("uses the earliest missed date", () => {
    const info = overdueInfo(
      item({ id: 1, planned_end_date: "2026-10-10", sprint_end_date: "2026-10-02" }),
      TODAY,
    )!;
    expect(info.reason).toBe("sprint_ended");
    expect(info.daysLate).toBe(10);
  });

  it("sorts most late first", () => {
    const list = overdueList(
      [
        item({ id: 1, planned_end_date: "2026-10-11" }),
        item({ id: 2, planned_end_date: "2026-09-01" }),
        item({ id: 3 }),
      ],
      TODAY,
    );
    expect(list.map((o) => o.item.id)).toEqual([2, 1]);
  });
});

describe("board", () => {
  it("orders columns by workflow priority with final states last", () => {
    const columns = groupByState([
      item({ id: 1, state: DONE }),
      item({ id: 2, state: IN_PROGRESS }),
      item({ id: 3 }),
      item({ id: 4, state: { ...IN_PROGRESS, id: 77 } }),
    ]);
    expect(columns.map((c) => c.name)).toEqual(["Open", "In Progress", "Done"]);
    expect(columns[1].items).toHaveLength(2);
  });
});

describe("sprint kpis", () => {
  const items = [
    item({ id: 1, effort: 5, state: DONE }),
    item({ id: 2, effort: 3 }),
    item({ id: 3, entity_type: "Task", user_story_id: 2, effort: 3 }),
    item({ id: 4, entity_type: "Bug", effort: 2, assigned: [{ id: 7, name: "Sam" }] }),
    item({ id: 5, entity_type: "Bug", user_story_id: 2, effort: 1 }),
  ];

  it("counts stories and loose bugs, not tasks", () => {
    expect(burndownUnits(items).map((i) => i.id)).toEqual([1, 2, 4]);
  });

  it("measures progress by effort", () => {
    const kpis = sprintKpis(items);
    expect(kpis.effortTotal).toBe(10);
    expect(kpis.effortDone).toBe(5);
    expect(kpis.progress).toBe(50);
    expect(kpis.bugsOpen).toBe(2);
    expect(kpis.unassigned).toBe(3);
  });

  it("falls back to counts without effort", () => {
    const kpis = sprintKpis([item({ id: 1, state: DONE }), item({ id: 2 }), item({ id: 3 }), item({ id: 4 })]);
    expect(kpis.progress).toBe(25);
  });

  it("groups children under their story", () => {
    expect(childrenByStory(items).get(2)!.map((i) => i.id)).toEqual([3, 5]);
  });
});
