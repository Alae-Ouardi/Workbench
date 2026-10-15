// Reading health out of raw Kubernetes objects: pod status the way kubectl
// prints it, workload readiness, ages.

import type { K8sObject } from "../types";

export type Tone = "ok" | "warn" | "bad" | "idle" | "info";

export interface Health {
  label: string;
  tone: Tone;
}

const BAD_REASONS = /CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|InvalidImageName|Evicted|Failed/;

/** Pod status as `kubectl get pods` shows it, plus a colour. */
export function podHealth(pod: K8sObject): Health {
  if (pod.metadata.deletionTimestamp) return { label: "Terminating", tone: "warn" };
  const status = pod.status ?? {};
  const phase: string = status.phase ?? "Unknown";
  if (status.reason) return { label: status.reason, tone: BAD_REASONS.test(status.reason) ? "bad" : "warn" };

  const containers: any[] = [...(status.initContainerStatuses ?? []), ...(status.containerStatuses ?? [])];
  for (const c of containers) {
    const waiting = c.state?.waiting?.reason;
    if (waiting && waiting !== "PodInitializing") return { label: waiting, tone: BAD_REASONS.test(waiting) ? "bad" : "warn" };
    const terminated = c.state?.terminated;
    if (terminated && terminated.reason !== "Completed" && phase !== "Succeeded") {
      return { label: terminated.reason ?? "Terminated", tone: "bad" };
    }
  }
  if (phase === "Running") {
    const ready = readyCount(pod);
    return ready.ready === ready.total ? { label: "Running", tone: "ok" } : { label: "Not ready", tone: "warn" };
  }
  if (phase === "Succeeded") return { label: "Completed", tone: "idle" };
  if (phase === "Pending") return { label: "Pending", tone: "warn" };
  if (phase === "Failed") return { label: "Failed", tone: "bad" };
  return { label: phase, tone: "info" };
}

export function readyCount(pod: K8sObject): { ready: number; total: number } {
  const statuses: any[] = pod.status?.containerStatuses ?? [];
  const total = (pod.spec?.containers ?? []).length || statuses.length;
  return { ready: statuses.filter((c) => c.ready).length, total };
}

export function restarts(pod: K8sObject): number {
  return (pod.status?.containerStatuses ?? []).reduce((sum: number, c: any) => sum + (c.restartCount ?? 0), 0);
}

/** Deployments, statefulsets, replicasets: ready / desired. */
export function workloadHealth(obj: K8sObject): Health {
  const desired = obj.spec?.replicas ?? 0;
  const ready = obj.status?.readyReplicas ?? 0;
  if (desired === 0) return { label: "Scaled to 0", tone: "idle" };
  if (ready >= desired) return { label: `${ready}/${desired}`, tone: "ok" };
  return { label: `${ready}/${desired}`, tone: ready === 0 ? "bad" : "warn" };
}

export function daemonHealth(obj: K8sObject): Health {
  const desired = obj.status?.desiredNumberScheduled ?? 0;
  const ready = obj.status?.numberReady ?? 0;
  return { label: `${ready}/${desired}`, tone: ready >= desired ? "ok" : ready === 0 ? "bad" : "warn" };
}

export function jobHealth(job: K8sObject): Health {
  const conditions: any[] = job.status?.conditions ?? [];
  if (conditions.some((c) => c.type === "Failed" && c.status === "True")) return { label: "Failed", tone: "bad" };
  if (conditions.some((c) => c.type === "Complete" && c.status === "True")) return { label: "Complete", tone: "idle" };
  if ((job.status?.active ?? 0) > 0) return { label: "Running", tone: "info" };
  return { label: "Pending", tone: "warn" };
}

export function nodeHealth(node: K8sObject): Health {
  const ready = (node.status?.conditions ?? []).find((c: any) => c.type === "Ready");
  if (node.spec?.unschedulable) return { label: "Cordoned", tone: "warn" };
  return ready?.status === "True" ? { label: "Ready", tone: "ok" } : { label: "Not ready", tone: "bad" };
}

/** Compact age like kubectl: 45s, 12m, 5h, 3d, 2y. */
export function age(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (s < 120) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 120) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 730 ? `${d}d` : `${Math.floor(d / 365)}y`;
}

export function formatCpu(milli: number): string {
  return milli >= 1000 ? `${(milli / 1000).toFixed(milli >= 10000 ? 0 : 1)}` : `${milli}m`;
}

export function formatBytes(bytes: number): string {
  const mi = bytes / 2 ** 20;
  return mi >= 1024 ? `${(mi / 1024).toFixed(1)}Gi` : `${Math.round(mi)}Mi`;
}
