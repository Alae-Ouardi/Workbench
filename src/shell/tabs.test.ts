import { describe, expect, it } from "vitest";
import { closeTab, cycleTab, initialTabs, moveTab, openTab, restoreTabs, selectByNumber, setScreen, type TabsState } from "./tabs";

const state = (ids: string[], activeId: string): TabsState => ({ tabs: ids.map((id) => ({ id, screen: "k8s" as const })), activeId });
const ids = (s: TabsState) => s.tabs.map((t) => t.id);

describe("tabs", () => {
  it("opens a new tab right after the active one", () => {
    const s = openTab(state(["a", "b", "c"], "a"), "db", "n");
    expect(ids(s)).toEqual(["a", "n", "b", "c"]);
    expect(s.activeId).toBe("n");
  });

  it("closing the active tab focuses the right neighbour, then the left", () => {
    expect(closeTab(state(["a", "b", "c"], "b"), "b").activeId).toBe("c");
    expect(closeTab(state(["a", "b", "c"], "c"), "c").activeId).toBe("b");
    expect(closeTab(state(["a", "b", "c"], "a"), "c").activeId).toBe("a");
  });

  it("closing the last tab leaves a fresh Home tab", () => {
    const s = closeTab(state(["a"], "a"), "a", "fresh");
    expect(s).toEqual({ tabs: [{ id: "fresh", screen: "home" }], activeId: "fresh" });
  });

  it("selects by number with 9 meaning last, and cycles", () => {
    const s = state(["a", "b", "c"], "a");
    expect(selectByNumber(s, 2).activeId).toBe("b");
    expect(selectByNumber(s, 9).activeId).toBe("c");
    expect(selectByNumber(s, 5).activeId).toBe("a");
    expect(cycleTab(s, -1).activeId).toBe("c");
    expect(cycleTab(s, 1).activeId).toBe("b");
  });

  it("changes a tab's screen and reorders", () => {
    expect(setScreen(initialTabs("x"), "x", "tp").tabs[0].screen).toBe("tp");
    expect(ids(moveTab(state(["a", "b", "c"], "a"), "a", 2))).toEqual(["b", "c", "a"]);
  });

  it("restores only valid stored tabs", () => {
    expect(restoreTabs({ tabs: [{ id: "a", screen: "k8s" }, { id: 3, screen: "x" }], activeId: "zz" })).toEqual({
      tabs: [{ id: "a", screen: "k8s" }],
      activeId: "a",
    });
    expect(restoreTabs(null).tabs).toHaveLength(1);
  });
});
