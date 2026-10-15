// Secret and ConfigMap contents. Secret values stay hidden: each key is
// fetched only when revealed or copied, and hidden again on demand.

import { useState } from "react";
import { copyText } from "../../shared/clipboard";
import { errorText, k8s } from "../api";
import type { EnvRef, K8sObject } from "../types";

export function SecretData({ env, secret }: { env: EnvRef; secret: K8sObject }) {
  const keys = Object.keys(secret.data ?? {}).sort();
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function value(key: string): Promise<string | null> {
    if (key in revealed) return revealed[key];
    setBusy(key);
    setError(null);
    try {
      return await k8s.secretValue(env, secret.metadata.name, key);
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function toggle(key: string) {
    if (key in revealed) {
      const { [key]: _hidden, ...rest } = revealed;
      setRevealed(rest);
      return;
    }
    const v = await value(key);
    if (v !== null) setRevealed((r) => ({ ...r, [key]: v }));
  }

  async function copy(key: string) {
    const v = await value(key);
    if (v !== null && (await copyText(v))) {
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    }
  }

  return (
    <div className="space-y-2 p-4">
      <p className="text-[11px] text-slate-500">Values are fetched only when you reveal or copy them.</p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {keys.length === 0 && <p className="py-6 text-center text-xs text-slate-500">This secret has no data.</p>}
      {keys.map((key) => (
        <div key={key} className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
          <div className="flex items-center gap-2">
            <span className="num text-[12.5px] font-semibold text-slate-100">{key}</span>
            <span className="ml-auto flex gap-1.5">
              <button className="btn py-0.5 text-[11px]" onClick={() => void toggle(key)} disabled={busy === key}>
                {key in revealed ? "Hide" : busy === key ? "…" : "Reveal"}
              </button>
              <button className="btn py-0.5 text-[11px]" onClick={() => void copy(key)} disabled={busy === key}>
                {copied === key ? "Copied ✓" : "Copy"}
              </button>
            </span>
          </div>
          <div className="num mt-2 text-[12px] break-all whitespace-pre-wrap">
            {key in revealed ? <span className="text-amber-100">{revealed[key] || <em className="text-slate-500">empty</em>}</span> : <span className="tracking-widest text-slate-600">••••••••••••</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConfigData({ config }: { config: K8sObject }) {
  const entries = Object.entries(config.data ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div className="space-y-3 p-4">
      {entries.length === 0 && <p className="py-6 text-center text-xs text-slate-500">No data.</p>}
      {entries.map(([key, value]) => (
        <div key={key} className="overflow-hidden rounded-xl border border-[var(--line)]">
          <div className="flex items-center border-b border-[var(--line-soft)] bg-[var(--panel-2)] px-3 py-1.5">
            <span className="num text-[12px] font-semibold text-slate-100">{key}</span>
            <button
              className="ml-auto text-[11px] text-slate-500 hover:text-slate-200"
              onClick={() => void copyText(value).then(() => setCopied(key))}
            >
              {copied === key ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <pre className="num max-h-72 overflow-auto p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap text-slate-300">{value}</pre>
        </div>
      ))}
    </div>
  );
}
