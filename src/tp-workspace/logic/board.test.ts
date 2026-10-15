import { describe, expect, it } from "vitest";
import { alignColumns, sortColumns } from "./board";
import { item } from "./fixtures";

const TODAY = "2026-10-12";

describe("board ordering", () => {
  it("puts stories first, then blocked, late and soonest-due work", () => {
    const [col] = sortColumns(
      [
        {
          key: "open",
          name: "Open",
          isFinal: false,
          items: [
            item({ id: 1, entity_type: "Task", planned_end_date: "2026-10-20" }),
            item({ id: 2, entity_type: "Task", planned_end_date: "2026-10-01" }),
            item({ id: 3, entity_type: "UserStory" }),
            item({ id: 4, entity_type: "Bug", tags: ["blocked"] }),
            item({ id: 5, entity_type: "Task", planned_end_date: "2026-10-13" }),
            item({ id: 6, entity_type: "Task" }),
          ],
        },
      ],
      TODAY,
    );
    expect(col.items.map((i) => i.id)).toEqual([3, 4, 2, 5, 1, 6]);
  });

  it("keeps every reference state as a column, in order", () => {
    const col = (key: string, ids: number[]) => ({ key, name: key, isFinal: key === "done", items: ids.map((id) => item({ id })) });
    const aligned = alignColumns([col("in progress", [2])], [col("open", [1]), col("in progress", [2, 3]), col("done", [4])]);
    expect(aligned.map((c) => [c.key, c.items.length])).toEqual([
      ["open", 0],
      ["in progress", 1],
      ["done", 0],
    ]);
  });
});
