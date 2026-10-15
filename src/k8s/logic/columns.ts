// What each resource list shows. Cells are plain data (text + tone) so the
// table component stays generic and this stays testable.

import type { K8sObject, ResourceKind, Usage } from "../types";
import {
  age,
  daemonHealth,
  formatBytes,
  formatCpu,
  jobHealth,
  nodeHealth,
  podHealth,
  readyCount,
  restarts,
  workloadHealth,
  type Tone,
} from "./status";

export interface Cell {
  text: string;
  tone?: Tone;
  /** Monospace (numbers, IPs, ports). */
  mono?: boolean;
  /** Value used for sorting when it differs from the text. */
  sort?: number | string;
  title?: string;
}

export interface ColumnDef {
  key: string;
  title: string;
  /** CSS grid track, e.g. "minmax(220px,2fr)" or "90px". */
  width: string;
  align?: "right";
  cell: (o: K8sObject, ctx: CellContext) => Cell;
}

export interface CellContext {
  now: number;
  usage: Map<string, Usage>;
}

const name: ColumnDef = { key: "name", title: "Name", width: "minmax(220px,2.4fr)", cell: (o) => ({ text: o.metadata.name }) };
const ageCol: ColumnDef = {
  key: "age",
  title: "Age",
  width: "64px",
  align: "right",
  cell: (o, c) => ({ text: age(o.metadata.creationTimestamp, c.now), mono: true, sort: -Date.parse(o.metadata.creationTimestamp ?? "0") }),
};
const keysCol = (field: string): ColumnDef => ({
  key: "keys",
  title: "Keys",
  width: "minmax(160px,2fr)",
  cell: (o) => {
    const keys = Object.keys(o[field] ?? {});
    return { text: keys.length ? keys.join(", ") : "—", title: keys.join("\n"), sort: keys.length };
  },
});

function images(o: K8sObject): string {
  const containers: any[] = o.spec?.template?.spec?.containers ?? o.spec?.jobTemplate?.spec?.template?.spec?.containers ?? [];
  return containers.map((c) => String(c.image ?? "").split("/").pop()).join(", ");
}

function ports(svc: K8sObject): string {
  return (svc.spec?.ports ?? [])
    .map((p: any) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol ?? "TCP"}`)
    .join(", ");
}

const COLUMNS: Record<ResourceKind, ColumnDef[]> = {
  pods: [
    name,
    {
      key: "status",
      title: "Status",
      width: "150px",
      cell: (o) => {
        const h = podHealth(o);
        return { text: h.label, tone: h.tone };
      },
    },
    {
      key: "ready",
      title: "Ready",
      width: "64px",
      align: "right",
      cell: (o) => {
        const r = readyCount(o);
        return { text: `${r.ready}/${r.total}`, mono: true, tone: r.ready === r.total ? undefined : "warn", sort: r.ready - r.total };
      },
    },
    {
      key: "restarts",
      title: "Restarts",
      width: "76px",
      align: "right",
      cell: (o) => {
        const n = restarts(o);
        return { text: String(n), mono: true, tone: n > 5 ? "bad" : n > 0 ? "warn" : undefined, sort: n };
      },
    },
    {
      key: "cpu",
      title: "CPU",
      width: "64px",
      align: "right",
      cell: (o, c) => {
        const u = c.usage.get(o.metadata.name);
        return { text: u ? formatCpu(u.cpu_m) : "—", mono: true, sort: u?.cpu_m ?? -1 };
      },
    },
    {
      key: "memory",
      title: "Memory",
      width: "76px",
      align: "right",
      cell: (o, c) => {
        const u = c.usage.get(o.metadata.name);
        return { text: u ? formatBytes(u.memory) : "—", mono: true, sort: u?.memory ?? -1 };
      },
    },
    { key: "node", title: "Node", width: "minmax(120px,1fr)", cell: (o) => ({ text: o.spec?.nodeName ?? "—" }) },
    ageCol,
  ],
  deployments: [
    name,
    {
      key: "ready",
      title: "Ready",
      width: "100px",
      cell: (o) => {
        const h = workloadHealth(o);
        return { text: h.label, tone: h.tone, mono: true };
      },
    },
    { key: "uptodate", title: "Up-to-date", width: "92px", align: "right", cell: (o) => ({ text: String(o.status?.updatedReplicas ?? 0), mono: true }) },
    { key: "images", title: "Images", width: "minmax(160px,2fr)", cell: (o) => ({ text: images(o), title: images(o) }) },
    ageCol,
  ],
  statefulsets: [
    name,
    {
      key: "ready",
      title: "Ready",
      width: "100px",
      cell: (o) => {
        const h = workloadHealth(o);
        return { text: h.label, tone: h.tone, mono: true };
      },
    },
    { key: "images", title: "Images", width: "minmax(160px,2fr)", cell: (o) => ({ text: images(o) }) },
    ageCol,
  ],
  daemonsets: [
    name,
    {
      key: "ready",
      title: "Ready",
      width: "100px",
      cell: (o) => {
        const h = daemonHealth(o);
        return { text: h.label, tone: h.tone, mono: true };
      },
    },
    { key: "images", title: "Images", width: "minmax(160px,2fr)", cell: (o) => ({ text: images(o) }) },
    ageCol,
  ],
  jobs: [
    name,
    {
      key: "status",
      title: "Status",
      width: "110px",
      cell: (o) => {
        const h = jobHealth(o);
        return { text: h.label, tone: h.tone };
      },
    },
    {
      key: "completions",
      title: "Completions",
      width: "100px",
      align: "right",
      cell: (o) => ({ text: `${o.status?.succeeded ?? 0}/${o.spec?.completions ?? 1}`, mono: true }),
    },
    ageCol,
  ],
  cronjobs: [
    name,
    { key: "schedule", title: "Schedule", width: "130px", cell: (o) => ({ text: o.spec?.schedule ?? "—", mono: true }) },
    {
      key: "suspend",
      title: "State",
      width: "90px",
      cell: (o) => (o.spec?.suspend ? { text: "Suspended", tone: "warn" } : { text: "Active", tone: "ok" }),
    },
    {
      key: "last",
      title: "Last run",
      width: "84px",
      align: "right",
      cell: (o, c) => ({ text: age(o.status?.lastScheduleTime, c.now), mono: true }),
    },
    ageCol,
  ],
  services: [
    name,
    { key: "type", title: "Type", width: "100px", cell: (o) => ({ text: o.spec?.type ?? "—" }) },
    { key: "ip", title: "Cluster IP", width: "120px", cell: (o) => ({ text: o.spec?.clusterIP ?? "—", mono: true }) },
    { key: "ports", title: "Ports", width: "minmax(140px,1.4fr)", cell: (o) => ({ text: ports(o) || "—", mono: true }) },
    ageCol,
  ],
  ingresses: [
    name,
    {
      key: "hosts",
      title: "Hosts",
      width: "minmax(200px,2fr)",
      cell: (o) => {
        const hosts = (o.spec?.rules ?? []).map((r: any) => r.host).filter(Boolean);
        return { text: hosts.join(", ") || "*", title: hosts.join("\n") };
      },
    },
    { key: "class", title: "Class", width: "100px", cell: (o) => ({ text: o.spec?.ingressClassName ?? "—" }) },
    ageCol,
  ],
  configmaps: [name, keysCol("data"), ageCol],
  secrets: [
    name,
    { key: "type", title: "Type", width: "minmax(140px,1fr)", cell: (o) => ({ text: String(o.type ?? "").replace("kubernetes.io/", "") }) },
    keysCol("data"),
    ageCol,
  ],
  persistentvolumeclaims: [
    name,
    {
      key: "status",
      title: "Status",
      width: "90px",
      cell: (o) => ({ text: o.status?.phase ?? "—", tone: o.status?.phase === "Bound" ? "ok" : "warn" }),
    },
    { key: "capacity", title: "Capacity", width: "90px", align: "right", cell: (o) => ({ text: o.status?.capacity?.storage ?? "—", mono: true }) },
    { key: "class", title: "Storage class", width: "minmax(120px,1fr)", cell: (o) => ({ text: o.spec?.storageClassName ?? "—" }) },
    ageCol,
  ],
  events: [
    {
      key: "type",
      title: "Type",
      width: "78px",
      cell: (o) => ({ text: o.type ?? "—", tone: o.type === "Warning" ? "warn" : "info" }),
    },
    { key: "reason", title: "Reason", width: "140px", cell: (o) => ({ text: o.reason ?? "—" }) },
    {
      key: "object",
      title: "Object",
      width: "minmax(160px,1.3fr)",
      cell: (o) => ({ text: `${String(o.involvedObject?.kind ?? "").toLowerCase()}/${o.involvedObject?.name ?? ""}` }),
    },
    { key: "message", title: "Message", width: "minmax(240px,3fr)", cell: (o) => ({ text: o.message ?? "", title: o.message }) },
    { key: "count", title: "Count", width: "60px", align: "right", cell: (o) => ({ text: String(o.count ?? 1), mono: true, sort: o.count ?? 1 }) },
    {
      key: "last",
      title: "Last seen",
      width: "84px",
      align: "right",
      cell: (o, c) => {
        const t = o.lastTimestamp ?? o.eventTime ?? o.metadata.creationTimestamp;
        return { text: age(t, c.now), mono: true, sort: -Date.parse(t ?? "0") };
      },
    },
  ],
  nodes: [
    name,
    {
      key: "status",
      title: "Status",
      width: "100px",
      cell: (o) => {
        const h = nodeHealth(o);
        return { text: h.label, tone: h.tone };
      },
    },
    {
      key: "cpu",
      title: "CPU",
      width: "64px",
      align: "right",
      cell: (o, c) => {
        const u = c.usage.get(o.metadata.name);
        return { text: u ? formatCpu(u.cpu_m) : "—", mono: true, sort: u?.cpu_m ?? -1 };
      },
    },
    {
      key: "memory",
      title: "Memory",
      width: "76px",
      align: "right",
      cell: (o, c) => {
        const u = c.usage.get(o.metadata.name);
        return { text: u ? formatBytes(u.memory) : "—", mono: true, sort: u?.memory ?? -1 };
      },
    },
    { key: "version", title: "Version", width: "110px", cell: (o) => ({ text: o.status?.nodeInfo?.kubeletVersion ?? "—", mono: true }) },
    ageCol,
  ],
};

/** Columns kept when the detail panel narrows the table. */
const COMPACT = new Set(["name", "status", "ready", "restarts", "type", "reason", "object", "last", "age"]);

export function columnsFor(kind: ResourceKind, compact = false): ColumnDef[] {
  const all = COLUMNS[kind];
  return compact ? all.filter((c) => COMPACT.has(c.key)).map((c) => (c.key === "name" ? { ...c, width: "minmax(160px,1fr)" } : c)) : all;
}

/** Sort objects by one column; ties fall back to name. */
export function sortObjects(objects: K8sObject[], column: ColumnDef, dir: "asc" | "desc", ctx: CellContext): K8sObject[] {
  const keyed = objects.map((o) => {
    const c = column.cell(o, ctx);
    return { o, k: c.sort ?? c.text };
  });
  const sign = dir === "asc" ? 1 : -1;
  keyed.sort((a, b) => {
    const cmp = typeof a.k === "number" && typeof b.k === "number" ? a.k - b.k : String(a.k).localeCompare(String(b.k), undefined, { numeric: true });
    return sign * cmp || a.o.metadata.name.localeCompare(b.o.metadata.name);
  });
  return keyed.map((x) => x.o);
}

/** Text filter over name, labels and every visible cell. */
export function filterObjects(objects: K8sObject[], query: string, columns: ColumnDef[], ctx: CellContext): K8sObject[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return objects;
  return objects.filter((o) => {
    const labels = Object.entries(o.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`).join(" ");
    const hay = `${columns.map((c) => c.cell(o, ctx).text).join(" ")} ${labels}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
