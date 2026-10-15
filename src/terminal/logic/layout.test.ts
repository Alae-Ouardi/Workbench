import { describe, expect, it } from "vitest";
import { closePane, neighbour, newPane, panes, rects, restoreFolders, setRatio, splitPane, tabLabel } from "./layout";
import type { PaneNode } from "../types";

const pane = (id: string, cwd = "/w"): PaneNode => ({ kind: "pane", id, cwd });

/** A 2×2 grid: a | b over c | d. */
function grid(): PaneNode {
  let root = pane("a");
  root = splitPane(root, "a", "col", pane("c"));
  root = splitPane(root, "a", "row", pane("b"));
  root = splitPane(root, "c", "row", pane("d"));
  return root;
}

describe("split layout", () => {
  it("splits right and down, keeping pane order", () => {
    const root = grid();
    expect(panes(root).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    const r = rects(root);
    expect(r.get("b")).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(r.get("c")).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
  });

  it("closing a pane gives its space to the sibling", () => {
    const root = closePane(grid(), "b")!;
    expect(panes(root).map((p) => p.id)).toEqual(["a", "c", "d"]);
    expect(rects(root).get("a")).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(closePane(pane("only"), "only")).toBeNull();
  });

  it("moves focus to the neighbouring pane", () => {
    const root = grid();
    expect(neighbour(root, "a", "right")).toBe("b");
    expect(neighbour(root, "a", "down")).toBe("c");
    expect(neighbour(root, "d", "left")).toBe("c");
    expect(neighbour(root, "d", "up")).toBe("b");
    expect(neighbour(root, "a", "left")).toBeNull();
  });

  it("clamps divider positions", () => {
    const root = splitPane(pane("a"), "a", "row", pane("b"));
    const id = root.kind === "split" ? root.id : "";
    const moved = setRatio(root, id, 0.99);
    expect(moved.kind === "split" && moved.ratio).toBe(0.85);
  });

  it("restores only well-formed saved folders", () => {
    const good = { id: "f1", path: "/Users/me/app", name: "", layout: grid(), focused: "zzz" };
    const restored = restoreFolders([good, { id: "f2", path: "/x", layout: { kind: "split" } }, null, "junk"]);
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("app");
    // Saved before tabs existed: the layout becomes the first tab.
    expect(restored[0].tabs).toHaveLength(1);
    expect(restored[0].tabs[0].focused).toBe("a");
    expect(restored[0].activeTab).toBe(restored[0].tabs[0].id);
    expect(restoreFolders("nope")).toEqual([]);
  });

  it("restores folders with tabs and names tabs by content", () => {
    const browser: PaneNode = { kind: "pane", id: "w", cwd: "/w", view: "browser", url: "http://localhost:5173/app" };
    const saved = {
      id: "f",
      path: "/w",
      name: "w",
      activeTab: "t2",
      tabs: [
        { id: "t1", layout: pane("a"), focused: "a" },
        { id: "t2", layout: browser, focused: "w" },
        { id: "t3", title: "Logs", layout: pane("b"), focused: "b" },
        { id: "bad", layout: { kind: "nope" } },
      ],
    };
    const [f] = restoreFolders([saved]);
    expect(f.tabs.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(f.activeTab).toBe("t2");
    expect(f.tabs.map((t) => tabLabel(t, f.tabs))).toEqual(["Terminal 1", "localhost:5173", "Logs"]);
    const titled = { ...f.tabs[1], layout: { ...browser, title: "My App" } };
    expect(tabLabel(titled, f.tabs)).toBe("My App");
  });

  it("creates panes with unique ids", () => {
    expect(newPane("/w").id).not.toBe(newPane("/w").id);
  });
});
