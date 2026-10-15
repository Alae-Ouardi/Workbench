import { describe, expect, it } from "vitest";
import { clampWidth, displayText, guessWidth, moveCursor, toTsv } from "./gridLogic";

describe("grid helpers", () => {
  it("renders values on one line", () => {
    expect(displayText(null)).toBe("");
    expect(displayText(false)).toBe("false");
    expect(displayText("a\n  b")).toBe("a ⏎ b");
    expect(displayText("x".repeat(400))).toHaveLength(301);
  });

  it("copies cells as TSV with NULLs", () => {
    expect(toTsv([[1, null], ["a\tb", true]])).toBe("1\tNULL\na b\ttrue");
  });

  it("keeps widths within bounds", () => {
    expect(clampWidth(10)).toBe(56);
    expect(clampWidth(9999)).toBe(640);
    expect(guessWidth("id", [1, 22, 333])).toBeGreaterThanOrEqual(56);
  });

  it("moves the cursor without leaving the grid", () => {
    expect(moveCursor({ row: 0, col: 0 }, "ArrowUp", 5, 3)).toEqual({ row: 0, col: 0 });
    expect(moveCursor({ row: 4, col: 2 }, "ArrowRight", 5, 3)).toEqual({ row: 4, col: 2 });
    expect(moveCursor({ row: 1, col: 1 }, "PageDown", 5, 3)).toEqual({ row: 4, col: 1 });
    expect(moveCursor({ row: 1, col: 1 }, "Home", 5, 3)).toEqual({ row: 1, col: 0 });
  });
});
