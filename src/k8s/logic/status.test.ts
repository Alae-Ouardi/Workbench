import { describe, expect, it } from "vitest";
import type { K8sObject } from "../types";
import { age, formatBytes, formatCpu, jobHealth, podHealth, readyCount, restarts, workloadHealth } from "./status";

const pod = (status: object, extra: object = {}): K8sObject => ({
  metadata: { name: "p", uid: "1" },
  spec: { containers: [{ name: "a" }, { name: "b" }] },
  status,
  ...extra,
});

describe("pod health", () => {
  it("reports running and ready", () => {
    const p = pod({ phase: "Running", containerStatuses: [{ ready: true, restartCount: 1 }, { ready: true, restartCount: 2 }] });
    expect(podHealth(p)).toEqual({ label: "Running", tone: "ok" });
    expect(readyCount(p)).toEqual({ ready: 2, total: 2 });
    expect(restarts(p)).toBe(3);
  });

  it("surfaces waiting reasons like CrashLoopBackOff", () => {
    const p = pod({ phase: "Running", containerStatuses: [{ ready: false, state: { waiting: { reason: "CrashLoopBackOff" } } }] });
    expect(podHealth(p)).toEqual({ label: "CrashLoopBackOff", tone: "bad" });
  });

  it("flags not-ready, completed and terminating pods", () => {
    expect(podHealth(pod({ phase: "Running", containerStatuses: [{ ready: true }, { ready: false }] })).label).toBe("Not ready");
    expect(podHealth(pod({ phase: "Succeeded" })).tone).toBe("idle");
    const deleting = pod({ phase: "Running" }, { metadata: { name: "p", uid: "1", deletionTimestamp: "x" } });
    expect(podHealth(deleting).label).toBe("Terminating");
  });

  it("treats evictions as failures", () => {
    expect(podHealth(pod({ phase: "Failed", reason: "Evicted" }))).toEqual({ label: "Evicted", tone: "bad" });
  });
});

describe("workloads", () => {
  it("compares ready with desired replicas", () => {
    const d = (replicas: number, ready: number) => ({ metadata: { name: "d", uid: "1" }, spec: { replicas }, status: { readyReplicas: ready } });
    expect(workloadHealth(d(3, 3)).tone).toBe("ok");
    expect(workloadHealth(d(3, 1))).toEqual({ label: "1/3", tone: "warn" });
    expect(workloadHealth(d(2, 0)).tone).toBe("bad");
    expect(workloadHealth(d(0, 0)).label).toBe("Scaled to 0");
  });

  it("reads job conditions", () => {
    const job = (conditions: object[], active = 0) => ({ metadata: { name: "j", uid: "1" }, status: { conditions, active } });
    expect(jobHealth(job([{ type: "Complete", status: "True" }])).label).toBe("Complete");
    expect(jobHealth(job([{ type: "Failed", status: "True" }])).tone).toBe("bad");
    expect(jobHealth(job([], 1)).label).toBe("Running");
  });
});

describe("formatting", () => {
  it("prints ages like kubectl", () => {
    const now = Date.parse("2026-10-12T12:00:00Z");
    expect(age("2026-10-12T11:59:30Z", now)).toBe("30s");
    expect(age("2026-10-12T11:00:00Z", now)).toBe("60m");
    expect(age("2026-10-12T00:00:00Z", now)).toBe("12h");
    expect(age("2026-10-01T12:00:00Z", now)).toBe("11d");
    expect(age(undefined, now)).toBe("—");
  });

  it("prints usage", () => {
    expect(formatCpu(250)).toBe("250m");
    expect(formatCpu(1500)).toBe("1.5");
    expect(formatBytes(512 * 2 ** 20)).toBe("512Mi");
    expect(formatBytes(3 * 2 ** 30)).toBe("3.0Gi");
  });
});
