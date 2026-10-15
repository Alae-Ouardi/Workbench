// Port-forwarding: a dialog to start one for a pod or service, and the list
// of running forwards (with copy and stop) shown in the sidebar.

import { useEffect, useMemo, useState } from "react";
import { copyText } from "../../shared/clipboard";
import { errorText, k8s, onForwardEnd } from "../api";
import type { EnvRef, ForwardInfo, K8sObject, ResourceKind } from "../types";

/** Ports a pod's containers or a service expose. */
export function exposedPorts(kind: ResourceKind, obj: K8sObject): { port: number; label: string }[] {
  if (kind === "services") {
    return (obj.spec?.ports ?? []).map((p: any) => ({ port: p.port, label: p.name ? `${p.port} (${p.name})` : String(p.port) }));
  }
  return (obj.spec?.containers ?? []).flatMap((c: any) =>
    (c.ports ?? []).map((p: any) => ({ port: p.containerPort, label: `${p.containerPort} · ${c.name}${p.name ? ` ${p.name}` : ""}` })),
  );
}

/** Local port suggestion: same number unless it needs root. */
export function suggestLocal(remote: number): number {
  return remote < 1024 ? remote + 10000 : remote;
}

export function ForwardDialog({
  env,
  kind,
  obj,
  onClose,
  onStarted,
}: {
  env: EnvRef;
  kind: ResourceKind;
  obj: K8sObject;
  onClose: () => void;
  onStarted: (f: ForwardInfo) => void;
}) {
  const ports = useMemo(() => exposedPorts(kind, obj), [kind, obj]);
  const [remote, setRemote] = useState<number>(ports[0]?.port ?? 8080);
  const [local, setLocal] = useState<number>(suggestLocal(ports[0]?.port ?? 8080));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = `${kind === "services" ? "service" : "pod"}/${obj.metadata.name}`;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      onStarted(await k8s.forwardStart(env, target, local, remote));
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="animate-rise w-[420px] rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-solid)] p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-slate-100">Port-forward</h2>
        <p className="num mt-1 truncate text-[11px] text-slate-500">
          {env.namespace} · {target}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-[11px] text-slate-500">
            Remote port
            {ports.length > 0 ? (
              <select
                className="input mt-1 w-full"
                value={remote}
                onChange={(e) => {
                  const p = Number(e.target.value);
                  setRemote(p);
                  setLocal(suggestLocal(p));
                }}
              >
                {ports.map((p) => (
                  <option key={p.label} value={p.port}>
                    {p.label}
                  </option>
                ))}
              </select>
            ) : (
              <input type="number" className="input num mt-1 w-full" value={remote} onChange={(e) => setRemote(Number(e.target.value))} />
            )}
          </label>
          <label className="text-[11px] text-slate-500">
            Local port
            <input type="number" className="input num mt-1 w-full" value={local} onChange={(e) => setLocal(Number(e.target.value))} />
          </label>
        </div>
        {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-rose-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !local || !remote} onClick={() => void start()}>
            {busy ? "Starting…" : `Forward localhost:${local}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Running forwards, kept in sync with the backend registry. */
export function useForwards() {
  const [forwards, setForwards] = useState<ForwardInfo[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void k8s.forwards().then(setForwards);
    void onForwardEnd((id, error) => {
      setForwards((f) => f.filter((x) => x.id !== id));
      if (error) setLastError(error);
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);
  return {
    forwards,
    lastError,
    add: (f: ForwardInfo) => setForwards((all) => [...all, f]),
    stop: async (id: number) => {
      await k8s.forwardStop(id);
      setForwards((f) => f.filter((x) => x.id !== id));
    },
  };
}

export function ForwardsList({ forwards, onStop }: { forwards: ForwardInfo[]; onStop: (id: number) => void }) {
  const [copied, setCopied] = useState<number | null>(null);
  if (!forwards.length) return null;
  return (
    <div className="mt-4">
      <div className="label mb-1.5 px-2">Port-forwards</div>
      <div className="space-y-1">
        {forwards.map((f) => (
          <div key={f.id} className="group rounded-lg border border-[var(--line-soft)] px-2 py-1.5" title={`${f.context}\n${f.namespace} · ${f.target}`}>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              <button
                className="num text-[12px] text-emerald-300 hover:underline"
                onClick={() => void copyText(`localhost:${f.local_port}`).then(() => setCopied(f.id))}
                title="Copy address"
              >
                {copied === f.id ? "copied ✓" : `:${f.local_port}`}
              </button>
              <span className="num text-[11px] text-slate-500">→ {f.remote_port}</span>
              {f.owner === "db" && <span className="chip py-0 text-[9px]">DB</span>}
              <button className="ml-auto text-[11px] text-slate-600 hover:text-rose-300" onClick={() => onStop(f.id)}>
                stop
              </button>
            </div>
            <div className="num truncate text-[10.5px] text-slate-500">{f.target.replace(/^(pod|service)\//, "")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
