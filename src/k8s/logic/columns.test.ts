import { describe, expect, it } from "vitest";
import type { K8sObject } from "../types";
import { columnsFor, filterObjects, sortObjects } from "./columns";

const ctx = { now: Date.parse("2026-10-12T12:00:00Z"), usage: new Map() };
const pod = (name: string, restartCount: number, labels: Record<string, string> = {}): K8sObject => ({
  metadata: { name, uid: name, labels, creationTimestamp: "2026-10-12T10:00:00Z" },
  spec: { containers: [{ name: "a" }] },
  status: { phase: "Running", containerStatuses: [{ ready: true, restartCount }] },
});

describe("resource columns", () => {
  const cols = columnsFor("pods");
  const restartsCol = cols.find((c) => c.key === "restarts")!;

  it("sorts numerically by the sort key", () => {
    const sorted = sortObjects([pod("a", 10), pod("b", 2), pod("c", 0)], restartsCol, "desc", ctx);
    expect(sorted.map((p) => p.metadata.name)).toEqual(["a", "b", "c"]);
  });

  it("colours restart counts", () => {
    expect(restartsCol.cell(pod("a", 7), ctx).tone).toBe("bad");
    expect(restartsCol.cell(pod("a", 0), ctx).tone).toBeUndefined();
  });

  it("filters on cells and labels", () => {
    const pods = [pod("api-1", 0, { app: "api" }), pod("worker-1", 0, { app: "worker" })];
    expect(filterObjects(pods, "app=worker", cols, ctx).map((p) => p.metadata.name)).toEqual(["worker-1"]);
    expect(filterObjects(pods, "running api", cols, ctx)).toHaveLength(1);
    expect(filterObjects(pods, "", cols, ctx)).toHaveLength(2);
  });

  it("defines columns for every kind", () => {
    for (const kind of ["pods", "deployments", "services", "secrets", "events", "nodes"] as const) {
      expect(columnsFor(kind).length).toBeGreaterThan(2);
    }
  });
});
