// Right-hand panel for the selected object: header with status and actions,
// then tabs that depend on the kind (logs and shell for pods, data for
// secrets and config maps…).

import { useEffect, useState } from "react";
import { IconClose } from "../../shared/icons";
import { podHealth } from "../logic/status";
import type { EnvRef, K8sObject, ResourceKind, Usage } from "../types";
import { Actions } from "./Actions";
import { ConfigData, SecretData } from "./DataTabs";
import { LogsView } from "./LogsView";
import { Overview } from "./Overview";
import { TONE_CLASS, TONE_DOT } from "./ResourceTable";
import { ShellView } from "./ShellView";
import { DescribeTab, EventsTab } from "./TextTabs";
import { YamlTab } from "./YamlTab";

export type DetailTab = "overview" | "logs" | "shell" | "data" | "events" | "yaml" | "describe";

const TAB_LABEL: Record<DetailTab, string> = {
  overview: "Overview",
  logs: "Logs",
  shell: "Shell",
  data: "Data",
  events: "Events",
  yaml: "YAML",
  describe: "Describe",
};

export function tabsFor(kind: ResourceKind): DetailTab[] {
  if (kind === "pods") return ["overview", "logs", "shell", "events", "yaml", "describe"];
  // Secret YAML would show every value, so secrets only offer per-key reveal.
  if (kind === "secrets") return ["data", "overview", "events", "describe"];
  if (kind === "configmaps") return ["data", "overview", "yaml", "events"];
  if (kind === "events") return ["overview", "yaml"];
  return ["overview", "events", "yaml", "describe"];
}

interface Props {
  env: EnvRef;
  kind: ResourceKind;
  obj: K8sObject;
  usage?: Usage;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  onClose: () => void;
  onForward: () => void;
  /** Gone from the live list (deleted while open). */
  gone: boolean;
}

export function DetailPanel({ env, kind, obj, usage, tab, onTab, onClose, onForward, gone }: Props) {
  const tabs = tabsFor(kind);
  const active = tabs.includes(tab) ? tab : tabs[0];
  const [toast, setToast] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const health = kind === "pods" ? podHealth(obj) : null;

  useEffect(() => setToast(null), [obj.metadata.uid]);
  useEffect(() => {
    if (toast?.tone !== "ok") return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <aside className="glass animate-rise flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
      <header className="border-b border-[var(--line)] px-4 pt-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="label">{kind.replace(/s$/, "")}</div>
            <h2 className="num mt-0.5 truncate text-[15px] font-semibold text-slate-50" title={obj.metadata.name}>
              {obj.metadata.name}
            </h2>
            {health && (
              <div className={`mt-1 flex items-center gap-1.5 text-[11.5px] ${TONE_CLASS[health.tone]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[health.tone]}`} />
                {health.label}
              </div>
            )}
            {gone && <div className="mt-1 text-[11.5px] text-amber-300">This object no longer exists.</div>}
          </div>
          <button className="btn px-1.5" onClick={onClose} title="Close (Esc)">
            <IconClose size={14} />
          </button>
        </div>
        <div className="mt-2.5">
          <Actions
            env={env}
            kind={kind}
            obj={obj}
            onForward={onForward}
            onDone={(text) => setToast({ tone: "ok", text })}
            onError={(text) => setToast({ tone: "bad", text })}
          />
        </div>
        {toast && (
          <p className={`mt-2 rounded-lg px-3 py-1.5 text-[12px] whitespace-pre-wrap ${toast.tone === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
            {toast.text}
          </p>
        )}
        <nav className="mt-3 -mb-px flex gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => onTab(t)}
              className={`border-b-2 px-2.5 pb-2 text-[12.5px] ${
                active === t ? "border-[var(--acc-400)] text-slate-50" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </nav>
      </header>
      <div className={`min-h-0 flex-1 ${active === "logs" || active === "shell" || active === "yaml" ? "flex flex-col" : "overflow-y-auto"}`}>
        {active === "overview" && <Overview kind={kind} obj={obj} usage={usage} />}
        {active === "logs" && <LogsView key={obj.metadata.uid} env={env} pod={obj} />}
        {active === "shell" && <ShellView key={obj.metadata.uid} env={env} pod={obj} />}
        {active === "data" && (kind === "secrets" ? <SecretData env={env} secret={obj} /> : <ConfigData config={obj} />)}
        {active === "events" && <EventsTab env={env} obj={obj} />}
        {active === "yaml" && <YamlTab env={env} kind={kind} obj={obj} />}
        {active === "describe" && <DescribeTab env={env} kind={kind} obj={obj} />}
      </div>
    </aside>
  );
}
