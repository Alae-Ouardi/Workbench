// One connection: connect with live step progress, then the session header
// (database, user, tunnel, time left) above the editor.

import { useEffect, useState, type ReactNode } from "react";
import { copyText } from "../../shared/clipboard";
import { envTier, isProdLike } from "../../shared/envKind";
import { ConnBadge } from "../components/ConnBadge";
import { STEPS, type Progress } from "../hooks/useSessions";
import { db } from "../api";
import { displayName, isLocal, scriptCommand, targetLine } from "../logic/connections";
import type { Connection, SessionInfo } from "../types";

interface Props {
  connection: Connection;
  folderName: string;
  session: SessionInfo | undefined;
  progress: Progress | undefined;
  ended: string | undefined;
  onConnect: () => void;
  /** Stop a connect in progress. */
  onCancel: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  /** Switch to a free local port and retry (offered when the port is busy). */
  onUsePort: (port: number) => void;
  /** The editor, once connected. */
  children?: ReactNode;
}

function minutesLeft(iso: string): number {
  return Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000));
}

export function ConnectionPage({ connection: c, folderName, session, progress, ended, onConnect, onCancel, onDisconnect, onEdit, onUsePort, children }: Props) {
  const local = isLocal(c);
  const tier = envTier(c.env);
  const steps = local ? STEPS.filter((s) => s.name === "database") : STEPS;
  const [, tick] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  async function copy(label: string, text: string | Promise<string>) {
    if (await copyText(await text)) {
      setCopied(label);
      setTimeout(() => setCopied((x) => (x === label ? null : x)), 1500);
    }
  }

  const header = (
    <header className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] px-5 py-3" style={!local && isProdLike(tier) ? { boxShadow: "inset 0 2px 0 #fb7185" } : undefined}>
      <ConnBadge connection={c} size="md" />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h1 className="num truncate text-[15px] font-semibold text-slate-50">{displayName(c)}</h1>
          <span className="truncate text-[11.5px] text-slate-500">{folderName}</span>
        </div>
        <div className="num truncate text-[11px] text-slate-500">
          {session ? `${session.user}@${session.host}:${session.local_port}/${session.database} · MySQL ${session.server_version}` : targetLine(c)}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {session ? (
          <>
            {session.expires_at && (
              <span className="num text-[11px] text-slate-500" title="The relay pod stops after an hour">
                {minutesLeft(session.expires_at)} min left
              </span>
            )}
            <button className="btn py-1 text-xs" onClick={() => void copy("details", `${session.host}:${session.local_port} · ${session.user} · ${session.database}`)}>
              {copied === "details" ? "Copied ✓" : "Copy details"}
            </button>
            <button className="btn py-1 text-xs" onClick={() => void copy("password", db.password(c.id))} title="For an external SQL client">
              {copied === "password" ? "Copied ✓" : "Copy password"}
            </button>
            <button className="btn py-1 text-xs text-rose-300" onClick={onDisconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <button className="btn py-1 text-xs" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
    </header>
  );

  if (session && children) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    );
  }

  const busy = progress?.busy ?? false;
  const freePort = local ? 0 : Number(/Port (\d+) is free/.exec(progress?.error ?? "")?.[1] ?? 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="mx-auto mt-[8vh] w-full max-w-lg px-6">
        {ended && <p className="mb-4 rounded-xl bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-200">{ended}</p>}
        <div className="glass rounded-2xl p-5">
          <ol className="space-y-3">
            {steps.map((s) => {
              const st = progress?.steps[s.name];
              const state = st?.state ?? "pending";
              return (
                <li key={s.name} className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                      state === "done"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : state === "error"
                          ? "bg-rose-500/20 text-rose-300"
                          : state === "running"
                            ? "border-2 border-amber-300/70 border-t-transparent animate-spin"
                            : "border border-[var(--line-strong)]"
                    }`}
                  >
                    {state === "done" ? "✓" : state === "error" ? "!" : ""}
                  </span>
                  <div className="min-w-0">
                    <div className={`text-[13px] ${state === "pending" ? "text-slate-500" : "text-slate-200"}`}>{s.label}</div>
                    {st?.detail && (
                      <div className={`num mt-0.5 text-[11px] break-all whitespace-pre-wrap ${state === "error" ? "text-rose-300" : "text-slate-500"}`}>{st.detail}</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {progress?.error && !Object.values(progress.steps).some((s) => s?.state === "error") && (
            <p className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-rose-300">{progress.error}</p>
          )}
          {freePort > 0 && !busy && (
            <button className="btn mt-4 w-full justify-center py-2 text-amber-200" onClick={() => onUsePort(freePort)}>
              Use port {freePort} for this connection and retry
            </button>
          )}
          {busy ? (
            <div className="mt-3 flex gap-2">
              <button className="btn btn-primary flex-1 justify-center py-2" disabled>
                Connecting…
              </button>
              <button className="btn justify-center px-4 py-2 text-rose-300" onClick={onCancel}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn btn-primary mt-3 w-full justify-center py-2" onClick={onConnect}>
              {progress?.error ? "Retry" : "Connect"}
            </button>
          )}
        </div>
        {!local && (
          <p className="num mt-3 truncate text-center text-[10.5px] text-slate-600" title={scriptCommand(c)}>
            same as $ {scriptCommand(c)}
          </p>
        )}
      </div>
    </div>
  );
}
