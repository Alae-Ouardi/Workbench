// Read-only tabs: events about an object, and `kubectl describe` output.

import { useEffect, useState } from "react";
import { errorText, k8s } from "../api";
import { age } from "../logic/status";
import type { EnvRef, K8sObject, ResourceKind } from "../types";

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    load()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload: () => setTick((t) => t + 1) };
}

export function EventsTab({ env, obj }: { env: EnvRef; obj: K8sObject }) {
  const { data, error, reload } = useLoad(() => k8s.eventsFor(env, obj.metadata.name), [env.context, env.namespace, obj.metadata.name]);
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">{data ? `${data.length} events` : "Loading…"}</span>
        <button className="btn py-1 text-xs" onClick={reload}>
          Refresh
        </button>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {data?.length === 0 && <p className="py-8 text-center text-xs text-slate-500">No recent events. Kubernetes keeps them for about an hour.</p>}
      <ol className="relative space-y-3 border-l border-[var(--line)] pl-4">
        {[...(data ?? [])].reverse().map((e) => {
          const warn = e.type === "Warning";
          const when = e.lastTimestamp ?? e.eventTime ?? e.metadata.creationTimestamp;
          return (
            <li key={e.metadata.uid} className="relative">
              <span className={`absolute top-1.5 -left-[21px] h-2 w-2 rounded-full ${warn ? "bg-amber-400" : "bg-sky-400"}`} />
              <div className="flex items-center gap-2 text-[12px]">
                <span className={`font-semibold ${warn ? "text-amber-300" : "text-slate-200"}`}>{e.reason}</span>
                {(e.count ?? 1) > 1 && <span className="chip num py-0">×{e.count}</span>}
                <span className="num ml-auto text-[11px] text-slate-500">{age(when)} ago</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-slate-400">{e.message}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function DescribeTab({ env, kind, obj }: { env: EnvRef; kind: ResourceKind; obj: K8sObject }) {
  const { data, error } = useLoad(
    () => k8s.describe({ ...env, kind, name: obj.metadata.name }),
    [env.context, env.namespace, kind, obj.metadata.name],
  );
  if (error) return <p className="p-4 text-xs text-rose-300">{error}</p>;
  return <pre className="num p-4 text-[11.5px] leading-relaxed whitespace-pre-wrap text-slate-300">{data ?? "Loading…"}</pre>;
}
