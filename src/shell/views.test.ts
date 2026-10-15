import { describe, expect, it } from "vitest";
import { homeHiddenTabs } from "./tabs";
import { restoreHidden, setHidden, visibleModes } from "./views";

describe("hidden views", () => {
  it("restores only known views and never all of them", () => {
    expect(restoreHidden(["db", "nope", 3])).toEqual(["db"]);
    expect(restoreHidden("db")).toEqual([]);
    expect(restoreHidden(["taskboard", "tp", "k8s", "db", "calendar", "terminal"])).toEqual([]);
  });

  it("keeps the view order and skips hidden ones", () => {
    expect(visibleModes(["tp", "calendar"])).toEqual(["taskboard", "k8s", "db", "terminal"]);
  });

  it("hides and shows a view", () => {
    expect(setHidden([], "db", true)).toEqual(["db"]);
    expect(setHidden(["db"], "taskboard", true)).toEqual(["taskboard", "db"]);
    expect(setHidden(["db", "tp"], "db", false)).toEqual(["tp"]);
  });

  it("refuses to hide the last visible view", () => {
    const allButTerminal = ["taskboard", "tp", "k8s", "db", "calendar"] as const;
    expect(setHidden(allButTerminal, "terminal", true)).toEqual([...allButTerminal]);
  });

  it("sends tabs of hidden views back to Home", () => {
    const state = { tabs: [{ id: "a", screen: "db" as const }, { id: "b", screen: "k8s" as const }], activeId: "a" };
    const next = homeHiddenTabs(state, ["db"]);
    expect(next.tabs.map((t) => t.screen)).toEqual(["home", "k8s"]);
    expect(next.activeId).toBe("a");
    expect(homeHiddenTabs(state, ["tp"])).toBe(state);
  });
});
