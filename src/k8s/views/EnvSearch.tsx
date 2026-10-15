// The Kubernetes entry point: search every environment (namespace) across
// all clusters, or browse a cluster's environments from the cluster list.
// Nothing else loads until an environment is picked.

import { useEffect, useMemo, useRef, useState } from "react";
import { EnvBadge } from "../../shared/EnvBadge";
import { envTier } from "../../shared/envKind";
import { IconCube, IconRefresh, IconSearch } from "../../shared/icons";
import { clientOf, envKey, parseEnvKey, searchEnvs, type EnvEntry } from "../logic/envSearch";
import type { ContextInfo, EnvRef } from "../types";

interface Props {
  entries: EnvEntry[];
  contexts: ContextInfo[];
  namespaces: Record<string, string[]>;
  contextsTotal: number;
  loadingContexts: Set<string>;
  errors: Record<string, string>;
  indexError: string | null;
  recents: string[];
  favourites: string[];
  onToggleFavourite: (key: string) => void;
  onPick: (env: EnvRef) => void;
  onRefresh: () => void;
  /** Shown as an overlay over an open environment (⌘E) rather than full page. */
  onClose?: () => void;
}

export function EnvSearch({
  entries,
  contexts,
  namespaces,
  contextsTotal,
  loadingContexts,
  errors,
  indexError,
  recents,
  favourites,
  onToggleFavourite,
  onPick,
  onRefresh,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pinned = useMemo(() => {
    const keys = [...favourites, ...recents.filter((r) => !favourites.includes(r))];
    return keys.map(parseEnvKey).filter((e): e is EnvRef => e !== null).slice(0, 10);
  }, [favourites, recents]);

  const results = useMemo(() => {
    if (!cluster) return searchEnvs(entries, query, 120);
    const inCluster = entries.filter((e) => e.context === cluster);
    // Inside one cluster show everything, plumbing namespaces last.
    return query.trim() ? searchEnvs(inCluster, query, 500) : inCluster;
  }, [entries, query, cluster]);
  const typed = query.trim().toLowerCase();
  // Clusters that refuse namespace listing: let a typed name open directly.
  const direct: EnvRef[] =
    cluster && /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(typed) && !results.some((r) => r.namespace === typed)
      ? [{ context: cluster, namespace: typed }]
      : [];
  const rows: EnvRef[] = query.trim() || cluster ? [...results, ...direct] : pinned;

  useEffect(() => setCursor(0), [query, cluster]);

  function openCluster(name: string | null) {
    setCluster(name);
    setQuery("");
    inputRef.current?.focus();
  }
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && rows[cursor]) {
      e.preventDefault();
      onPick(rows[cursor]);
    } else if (e.key === "Backspace" && !query && cluster) {
      openCluster(null);
    } else if (e.key === "Escape") {
      if (cluster) openCluster(null);
      else onClose?.();
    }
  }

  const contextsReady = contextsTotal - loadingContexts.size;
  const failing = Object.keys(errors).length;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 pt-[9vh] pb-6">
      <div className="animate-rise mb-6 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-emerald-300" style={{ background: "#34d3991a", boxShadow: "inset 0 0 0 1px #34d39940" }}>
          <IconCube size={24} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Which environment?</h1>
        <p className="mt-1.5 text-xs text-slate-500">
          Search {entries.length.toLocaleString()} namespaces across {contextsTotal} clusters — try <span className="num text-slate-300">review acme</span> or <span className="num text-slate-300">prod-</span>
        </p>
      </div>

      <div className="glass-strong neon-ring flex items-center gap-3 rounded-2xl px-4 py-3.5">
        <IconSearch size={18} className="text-emerald-300" />
        {cluster && (
          <span className="chip num shrink-0 gap-1.5 border-emerald-400/40 text-emerald-200">
            in {cluster}
            <button className="text-slate-400 hover:text-slate-100" onClick={() => openCluster(null)} aria-label="All clusters">
              ×
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={cluster ? "Filter this cluster's environments…" : "Environment, client or cluster…"}
          className="bare-input flex-1 bg-transparent text-[15px] text-slate-100 outline-none placeholder:text-slate-600"
        />
        <button className="btn px-2" onClick={onRefresh} title="Reload clusters and namespaces">
          <IconRefresh size={14} className={loadingContexts.size ? "animate-spin" : ""} />
        </button>
        {onClose && <kbd className="chip num">esc</kbd>}
      </div>

      <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-600">
        <span>
          {loadingContexts.size > 0 ? `Loading namespaces… ${contextsReady}/${contextsTotal} clusters` : `${contextsTotal} clusters indexed`}
          {failing > 0 && (
            <span className="text-amber-400/80" title={Object.entries(errors).map(([c, e]) => `${c}: ${e}`).join("\n")}>
              {" "}· {failing} without namespace access
            </span>
          )}
        </span>
        <span>↑↓ choose · ↵ open</span>
      </div>
      {indexError && <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{indexError}</p>}

      <div ref={listRef} className="mt-4 min-h-0 flex-1 overflow-y-auto">
        {!query.trim() && pinned.length > 0 && <div className="label mb-2 px-1">Favourites & recent</div>}
        {cluster && !query.trim() && (
          <div className="label mb-2 px-1">
            {rows.length} environments in {cluster}
          </div>
        )}
        {(query.trim() || cluster) && rows.length === 0 && !direct.length && (
          <p className="px-3 py-10 text-center text-xs text-slate-500">
            {loadingContexts.size ? "Still loading namespaces…" : `No environment matches “${query}”.`}
          </p>
        )}
        <div className="space-y-1">
          {rows.map((env, i) => {
            const key = envKey(env);
            const fav = favourites.includes(key);
            const tier = envTier(env.namespace, env.context);
            const isRecent = recents.includes(key);
            return (
              <div
                key={key}
                data-row={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => onPick(env)}
                className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                  i === cursor ? "border-[var(--line-strong)] bg-[var(--line)]" : "border-transparent hover:bg-[var(--line-soft)]"
                }`}
              >
                <EnvBadge tier={tier} />
                <div className="min-w-0 flex-1">
                  <div className="num truncate text-[13.5px] font-medium text-slate-100">{env.namespace}</div>
                  <div className="truncate text-[11px] text-slate-500">
                    {env.context}
                    {clientOf(env.namespace) !== env.namespace && <span className="text-slate-600"> · client {clientOf(env.namespace)}</span>}
                  </div>
                </div>
                {isRecent && !query.trim() && !fav && <span className="text-[10px] text-slate-600">recent</span>}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavourite(key);
                  }}
                  className={`text-base leading-none ${fav ? "text-amber-300" : "text-slate-700 opacity-0 group-hover:opacity-100 hover:text-amber-300"}`}
                  title={fav ? "Remove from favourites" : "Add to favourites"}
                >
                  {fav ? "★" : "☆"}
                </button>
              </div>
            );
          })}
        </div>

        {!query.trim() && !cluster && (
          <ClusterList contexts={contexts} namespaces={namespaces} loading={loadingContexts} errors={errors} onOpen={openCluster} />
        )}
      </div>
    </div>
  );
}

function ClusterList({
  contexts,
  namespaces,
  loading,
  errors,
  onOpen,
}: {
  contexts: ContextInfo[];
  namespaces: Record<string, string[]>;
  loading: Set<string>;
  errors: Record<string, string>;
  onOpen: (name: string) => void;
}) {
  if (!contexts.length) return null;
  return (
    <div className="mt-6">
      <div className="label mb-2 px-1">Clusters ({contexts.length})</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {contexts.map((c) => {
          const count = namespaces[c.name]?.length ?? 0;
          const busy = loading.has(c.name);
          const error = errors[c.name];
          const tier = envTier(c.name);
          return (
            <button
              key={c.name}
              onClick={() => onOpen(c.name)}
              title={error ? `${c.name}\n${error}` : c.name}
              className="glass group flex items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-all hover:-translate-y-px hover:border-[var(--line-strong)]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-300" style={{ background: "#34d39914" }}>
                <IconCube size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="num truncate text-[12.5px] font-medium text-slate-100">{c.name}</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {busy ? "Loading…" : error && !count ? <span className="text-amber-400/80">No namespace access</span> : `${count} environment${count === 1 ? "" : "s"}`}
                </div>
              </div>
              {tier !== "other" && <EnvBadge tier={tier} />}
              <span className="text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-300">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
