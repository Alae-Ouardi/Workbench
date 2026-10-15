// Add or edit a connection. Shows where it will point (cluster + namespace)
// and the equivalent connector-script command while typing.

import { useState } from "react";
import { EnvBadge } from "../../shared/EnvBadge";
import { envTier } from "../../shared/envKind";
import { resolveTarget, scriptCommand, sharedClusterContext } from "../logic/connections";
import { useKnownContexts } from "../useKnownContexts";
import { DB_ENVS, type Connection, type ConnectionsFile, type DbEnv } from "../types";


interface Props {
  file: ConnectionsFile;
  initial: Connection;
  isNew: boolean;
  onSave: (c: Connection, newFolderName: string | null) => Promise<boolean>;
  onClose: () => void;
  error: string | null;
}

export function ConnectionForm({ file, initial, isNew, onSave, onClose, error }: Props) {
  const [c, setC] = useState<Connection>(initial);
  const [newFolder, setNewFolder] = useState<string | null>(file.folders.length === 0 ? "" : null);
  const [advanced, setAdvanced] = useState(Boolean(initial.namespace || initial.secret !== "db-shifteo-services"));
  const [busy, setBusy] = useState(false);
  const contexts = useKnownContexts();
  const target = resolveTarget(c);
  const shared = Boolean(c.context);
  const set = <K extends keyof Connection>(key: K, value: Connection[K]) => setC((prev) => ({ ...prev, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave(c, newFolder !== null ? newFolder.trim() : null);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={(e) => void submit(e)}
        onClick={(e) => e.stopPropagation()}
        className="animate-rise max-h-[90vh] w-[560px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-solid)] p-5"
      >
        <h2 className="text-[16px] font-semibold text-slate-50">{isNew ? "New connection" : "Edit connection"}</h2>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 text-[11px] text-slate-500">
            Client folder
            {newFolder === null ? (
              <select
                className="input mt-1"
                value={c.folder_id}
                onChange={(e) => (e.target.value === "__new" ? setNewFolder("") : set("folder_id", e.target.value))}
              >
                {[...file.folders]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                <option value="__new">+ New folder…</option>
              </select>
            ) : (
              <input
                autoFocus
                className="input mt-1"
                placeholder="Client name, e.g. Acme"
                value={newFolder}
                onChange={(e) => {
                  setNewFolder(e.target.value);
                  if (isNew && !c.client) set("client", e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
                }}
              />
            )}
          </label>

          <div className="col-span-2 text-[11px] text-slate-500">
            Environment
            <div className="mt-1 flex gap-1.5">
              {DB_ENVS.map((env: DbEnv) => (
                <button
                  type="button"
                  key={env}
                  onClick={() => set("env", env)}
                  className={`flex-1 rounded-lg border py-1.5 text-[12px] ${c.env === env ? "border-[var(--line-strong)] bg-[var(--line)]" : "border-[var(--line)] hover:bg-[var(--line-soft)]"}`}
                >
                  <EnvBadge tier={envTier(env)} />
                </button>
              ))}
            </div>
          </div>

          <label className="text-[11px] text-slate-500">
            Client
            <input className="input num mt-1" value={c.client} onChange={(e) => set("client", e.target.value.toLowerCase())} placeholder="acme" required />
          </label>
          <label className="text-[11px] text-slate-500">
            Local port
            <input type="number" className="input num mt-1" value={c.local_port} min={1024} max={65535} onChange={(e) => set("local_port", Number(e.target.value))} />
          </label>
          <label className="text-[11px] text-slate-500">
            Name <span className="text-slate-600">(optional)</span>
            <input className="input mt-1" value={c.name} onChange={(e) => set("name", e.target.value)} placeholder={`${c.env}-${c.client || "client"}`} />
          </label>
          <label className="text-[11px] text-slate-500">
            Cluster domain
            <input className="input num mt-1" value={c.cluster_domain} onChange={(e) => set("cluster_domain", e.target.value)} />
          </label>

          <div className="col-span-2 rounded-xl border border-[var(--line)] px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={shared}
                onClick={() => set("context", shared ? null : sharedClusterContext(c.cluster_domain))}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${shared ? "bg-sky-500" : "bg-[var(--line-strong)]"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${shared ? "left-[18px]" : "left-0.5"}`} />
              </button>
              <span className="text-[12px] text-slate-300">
                Shared cluster <span className="text-slate-500">— adds <code className="num">--context</code></span>
              </span>
            </label>
            <p className="mt-1 pl-12 text-[10.5px] text-slate-500">
              Turn on for clients whose database runs on the shared cluster (e.g. prod.euc1), even if they also have their own context.
            </p>
            {shared && (
              <label className="mt-2 block pl-12 text-[11px] text-slate-500">
                Context
                <input
                  className="input num mt-1"
                  list="db-known-contexts"
                  value={c.context ?? ""}
                  onChange={(e) => set("context", e.target.value)}
                  onBlur={() => !c.context?.trim() && set("context", sharedClusterContext(c.cluster_domain))}
                  autoFocus
                />
                <datalist id="db-known-contexts">
                  {contexts.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
            )}
          </div>
        </div>

        <button type="button" className="mt-3 text-[11.5px] text-sky-300 hover:underline" onClick={() => setAdvanced(!advanced)}>
          {advanced ? "Hide" : "Show"} namespace and secret
        </button>
        {advanced && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-[11px] text-slate-500">
              Namespace
              <input className="input num mt-1" value={c.namespace ?? ""} onChange={(e) => set("namespace", e.target.value || null)} placeholder={`${c.env}-${c.client}`} />
            </label>
            <label className="text-[11px] text-slate-500">
              Secret
              <input className="input num mt-1" value={c.secret} onChange={(e) => set("secret", e.target.value)} />
            </label>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3 text-[11.5px]">
          <div className="flex items-center gap-2">
            <EnvBadge tier={envTier(c.env)} />
            <span className="num text-slate-200">{target.namespace}</span>
            <span className="text-slate-600">on</span>
            <span className="num truncate text-slate-300">{target.context}</span>
          </div>
          <div className="num mt-2 break-all text-[10.5px] text-slate-500">
            $ {scriptCommand(c)}
          </div>
        </div>

        {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !c.client || (newFolder !== null && !newFolder.trim())}>
            {busy ? "Saving…" : isNew ? "Add connection" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
