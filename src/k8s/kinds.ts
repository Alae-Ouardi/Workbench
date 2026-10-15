import type { ResourceKind } from "./types";

export const KIND_GROUPS: { title: string; kinds: { kind: ResourceKind; label: string }[] }[] = [
  {
    title: "Workloads",
    kinds: [
      { kind: "pods", label: "Pods" },
      { kind: "deployments", label: "Deployments" },
      { kind: "statefulsets", label: "Stateful sets" },
      { kind: "daemonsets", label: "Daemon sets" },
      { kind: "jobs", label: "Jobs" },
      { kind: "cronjobs", label: "Cron jobs" },
    ],
  },
  {
    title: "Network",
    kinds: [
      { kind: "services", label: "Services" },
      { kind: "ingresses", label: "Ingresses" },
    ],
  },
  {
    title: "Config & storage",
    kinds: [
      { kind: "configmaps", label: "Config maps" },
      { kind: "secrets", label: "Secrets" },
      { kind: "persistentvolumeclaims", label: "Volumes" },
    ],
  },
  {
    title: "Cluster",
    kinds: [
      { kind: "events", label: "Events" },
      { kind: "nodes", label: "Nodes" },
    ],
  },
];

export const ALL_KINDS = KIND_GROUPS.flatMap((g) => g.kinds);

export function kindLabel(kind: ResourceKind): string {
  return ALL_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}
