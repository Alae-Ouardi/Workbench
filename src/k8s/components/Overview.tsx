// Overview tab: the essentials of an object at a glance. Pods get container
// cards (state, restarts, last crash, image, resources, usage); every kind
// gets metadata, labels and the spec fields people look for.

import type { ReactNode } from "react";
import { age, formatBytes, formatCpu, podHealth, type Tone } from "../logic/status";
import type { K8sObject, ResourceKind, Usage } from "../types";
import { TONE_CLASS, TONE_DOT } from "./ResourceTable";

export function Overview({ kind, obj, usage }: { kind: ResourceKind; obj: K8sObject; usage?: Usage }) {
  return (
    <div className="space-y-5 p-4">
      {kind === "pods" && <PodSummary pod={obj} usage={usage} />}
      {kind === "pods" && <Containers pod={obj} />}
      <SpecHighlights kind={kind} obj={obj} />
      <Section title="Metadata">
        <Facts
          rows={[
            ["Created", obj.metadata.creationTimestamp ? `${new Date(obj.metadata.creationTimestamp).toLocaleString()} (${age(obj.metadata.creationTimestamp)} ago)` : "—"],
            ["Owner", (obj.metadata.ownerReferences ?? []).map((o) => `${o.kind}/${o.name}`).join(", ") || "—"],
            ["UID", obj.metadata.uid],
          ]}
        />
      </Section>
      <KeyValues title="Labels" values={obj.metadata.labels} />
      <KeyValues title="Annotations" values={obj.metadata.annotations} />
    </div>
  );
}

function PodSummary({ pod, usage }: { pod: K8sObject; usage?: Usage }) {
  const health = podHealth(pod);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Status" value={health.label} tone={health.tone} />
      <Stat label="Node" value={pod.spec?.nodeName ?? "—"} />
      <Stat label="Pod IP" value={pod.status?.podIP ?? "—"} mono />
      <Stat label="CPU · Memory" value={usage ? `${formatCpu(usage.cpu_m)} · ${formatBytes(usage.memory)}` : "—"} mono />
    </div>
  );
}

function Containers({ pod }: { pod: K8sObject }) {
  const statuses = new Map<string, any>((pod.status?.containerStatuses ?? []).map((s: any) => [s.name, s]));
  return (
    <Section title={`Containers (${(pod.spec?.containers ?? []).length})`}>
      <div className="space-y-2">
        {(pod.spec?.containers ?? []).map((c: any) => {
          const s = statuses.get(c.name);
          const state = s?.state ? Object.keys(s.state)[0] : "unknown";
          const reason = s?.state?.[state]?.reason;
          const last = s?.lastState?.terminated;
          const tone: Tone = s?.ready ? "ok" : state === "waiting" ? "bad" : "warn";
          return (
            <div key={c.name} className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${TONE_DOT[tone]}`} />
                <span className="text-[13px] font-semibold text-slate-100">{c.name}</span>
                <span className={`text-[11px] ${TONE_CLASS[tone]}`}>{reason ?? state}</span>
                <span className="num ml-auto text-[11px] text-slate-500">{s?.restartCount ?? 0} restarts</span>
              </div>
              <div className="num mt-1.5 truncate text-[11px] text-slate-400" title={c.image}>
                {c.image}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
                {(c.ports ?? []).map((p: any) => (
                  <span key={`${p.containerPort}${p.protocol}`} className="chip num">
                    :{p.containerPort}
                    {p.name ? ` ${p.name}` : ""}
                  </span>
                ))}
                {c.resources?.requests && (
                  <span className="chip num" title="Requests">
                    req {c.resources.requests.cpu ?? "–"} / {c.resources.requests.memory ?? "–"}
                  </span>
                )}
                {c.resources?.limits && (
                  <span className="chip num" title="Limits">
                    lim {c.resources.limits.cpu ?? "–"} / {c.resources.limits.memory ?? "–"}
                  </span>
                )}
              </div>
              {last && (
                <p className="mt-2 rounded-lg bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-300">
                  Last exit: {last.reason ?? "terminated"} (code {last.exitCode}) {last.finishedAt ? `· ${age(last.finishedAt)} ago` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SpecHighlights({ kind, obj }: { kind: ResourceKind; obj: K8sObject }) {
  const rows: [string, ReactNode][] = [];
  const spec = obj.spec ?? {};
  if (["deployments", "statefulsets"].includes(kind)) {
    rows.push(["Replicas", `${obj.status?.readyReplicas ?? 0} ready / ${spec.replicas ?? 0} desired`]);
    rows.push(["Strategy", spec.strategy?.type ?? spec.updateStrategy?.type ?? "—"]);
  }
  if (spec.selector?.matchLabels) rows.push(["Selector", Object.entries(spec.selector.matchLabels).map(([k, v]) => `${k}=${v}`).join(", ")]);
  if (kind === "services") {
    rows.push(["Type", spec.type ?? "—"]);
    rows.push(["Cluster IP", spec.clusterIP ?? "—"]);
    rows.push(["Ports", (spec.ports ?? []).map((p: any) => `${p.name ? `${p.name} ` : ""}${p.port}→${p.targetPort}`).join(", ")]);
    if (spec.selector) rows.push(["Selector", Object.entries(spec.selector).map(([k, v]) => `${k}=${v}`).join(", ")]);
  }
  if (kind === "ingresses") {
    for (const rule of spec.rules ?? []) {
      for (const p of rule.http?.paths ?? []) {
        rows.push([rule.host ?? "*", `${p.path ?? "/"} → ${p.backend?.service?.name ?? "?"}:${p.backend?.service?.port?.number ?? p.backend?.service?.port?.name ?? ""}`]);
      }
    }
  }
  if (kind === "cronjobs") {
    rows.push(["Schedule", spec.schedule]);
    rows.push(["Suspended", spec.suspend ? "yes" : "no"]);
  }
  if (kind === "persistentvolumeclaims") {
    rows.push(["Requested", spec.resources?.requests?.storage ?? "—"]);
    rows.push(["Access", (spec.accessModes ?? []).join(", ")]);
  }
  if (kind === "events") {
    rows.push(["Message", obj.message ?? ""]);
    rows.push(["Object", `${obj.involvedObject?.kind}/${obj.involvedObject?.name}`]);
  }
  const conditions: any[] = obj.status?.conditions ?? [];
  return (
    <>
      {rows.length > 0 && (
        <Section title="Spec">
          <Facts rows={rows} />
        </Section>
      )}
      {conditions.length > 0 && (
        <Section title="Conditions">
          <div className="space-y-1">
            {conditions.map((c) => (
              <div key={c.type} className="flex items-center gap-2 text-[12px]">
                <span className={`h-1.5 w-1.5 rounded-full ${c.status === "True" ? TONE_DOT.ok : TONE_DOT.warn}`} />
                <span className="w-40 text-slate-300">{c.type}</span>
                <span className="truncate text-slate-500" title={c.message}>
                  {c.reason ?? ""} {c.message ?? ""}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="label mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="num break-all text-slate-200">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function KeyValues({ title, values }: { title: string; values?: Record<string, string> }) {
  const entries = Object.entries(values ?? {});
  if (!entries.length) return null;
  return (
    <Section title={`${title} (${entries.length})`}>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([k, v]) => (
          <span key={k} className="chip num max-w-full" title={`${k}=${v}`}>
            <span className="truncate text-slate-500">{k}</span>
            <span className="truncate text-slate-200">{v.length > 80 ? `${v.slice(0, 80)}…` : v}</span>
          </span>
        ))}
      </div>
    </Section>
  );
}

function Stat({ label, value, tone, mono }: { label: string; value: string; tone?: Tone; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2">
      <div className="label">{label}</div>
      <div className={`mt-1 truncate text-[13px] font-medium ${tone ? TONE_CLASS[tone] : "text-slate-100"} ${mono ? "num" : ""}`} title={value}>
        {value}
      </div>
    </div>
  );
}
