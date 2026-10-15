import { describe, expect, it } from "vitest";
import { appName, appNames, billableHours, elapsed, matchShortcut, minutesBetween, parseHours } from "./logic";

describe("meeting rounding", () => {
  it("rounds up to the step with a minimum", () => {
    expect(billableHours(5, 30, 15)).toBe(0.5);
    expect(billableHours(31, 30, 15)).toBe(0.75);
    expect(billableHours(45, 30, 15)).toBe(0.75);
    expect(billableHours(61, 30, 15)).toBe(1.25);
    expect(billableHours(7, 0, 5)).toBe(10 / 60);
  });

  it("measures meetings in minutes", () => {
    expect(minutesBetween("2026-10-13T09:00:00Z", "2026-10-13T09:47:30Z")).toBe(47.5);
    expect(minutesBetween("2026-10-13T10:00:00Z", "2026-10-13T09:00:00Z")).toBe(0);
  });
});

describe("display", () => {
  it("formats the running timer", () => {
    const start = "2026-10-13T09:00:00Z";
    expect(elapsed(start, Date.parse("2026-10-13T09:04:05Z"))).toBe("4:05");
    expect(elapsed(start, Date.parse("2026-10-13T10:02:09Z"))).toBe("1:02:09");
  });

  it("names the meeting apps", () => {
    expect(appName("com.microsoft.teams2")).toBe("Teams");
    expect(appName("com.example.Recorder")).toBe("Recorder");
    expect(appNames(["com.microsoft.teams", "com.microsoft.teams2", "us.zoom.xos"])).toBe("Teams, Zoom");
  });

  it("reads typed hours", () => {
    expect(parseHours("0,75")).toBe(0.75);
    expect(parseHours("1.333")).toBe(1.33);
    expect(parseHours("0")).toBeNull();
    expect(parseHours("abc")).toBeNull();
    expect(parseHours("13")).toBeNull();
  });
});

describe("settings validation", async () => {
  const { settingsProblem } = await import("./MeetingSettingsView");
  const base = {
    enabled: true, daily_task_id: 1, meetings_task_id: 0, min_minutes: 30, step_minutes: 15,
    shortcuts: [], recurring: [], weekly_off: [6, 7], days_off: [], region: "none" as const, holiday_choices: [], imported: true, reminder_minutes: 5,
  };
  it("accepts sensible settings and explains bad ones", () => {
    expect(settingsProblem(base)).toBeNull();
    expect(settingsProblem({ ...base, step_minutes: 0 })).toMatch(/step/);
    expect(settingsProblem({ ...base, shortcuts: [{ id: "a", name: "", task_id: 3, description: "" }] })).toMatch(/shortcut/);
    expect(settingsProblem({ ...base, recurring: [{ id: "r", label: "x", task_id: 3, hours: -1 }] })).toMatch(/recurring/);
  });
});

describe("scheduled meeting names", () => {
  const shortcuts = [{ name: "Sprint review" }, { name: "Daily" }, { name: "QA" }];
  it("matches a shortcut named like the meeting", () => {
    expect(matchShortcut("Sprint Review — Team Evo", shortcuts)?.name).toBe("Sprint review");
    expect(matchShortcut("daily", shortcuts)?.name).toBe("Daily");
    expect(matchShortcut("1:1 with lead", shortcuts)).toBeUndefined();
    expect(matchShortcut(null, shortcuts)).toBeUndefined();
  });
});
