// Kubernetes workspace. Opens on the environment search; once an environment
// (cluster + namespace) is picked, its resources load live in a table with a
// detail panel (logs, shell, YAML…) beside it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTabActive, useTabState, useTabTitle } from "../shell/TabContext";
import { AppSwitcher } from "../shell/AppSwitcher";
import { EnvBadge } from "../shared/EnvBadge";
import { envTier, isProdLike } from "../shared/envKind";
import { IconCube, IconRefresh, IconSearch } from "../shared/icons";
import { Palette } from "../shared/Palette";
import { useLocalState } from "../shared/useLocalState";
import { k8s } from "./api";
import { DetailPanel, type DetailTab } from "./components/DetailPanel";
import { ForwardDialog, ForwardsList, useForwards } from "./components/Forwards";
import { ResourceTable } from "./components/ResourceTable";
import { useEnvIndex } from "./hooks/useEnvIndex";
import { usePaletteEntries } from "./hooks/usePaletteEntries";
import { useWatchList } from "./hooks/useWatchList";
import { ALL_KINDS, KIND_GROUPS, kindLabel } from "./kinds";
import { columnsFor, filterObjects, sortObjects, type CellContext } from "./logic/columns";
import { envKey, pushRecent } from "./logic/envSearch";
import type { EnvRef, K8sObject, ResourceKind, Usage } from "./types";
import { EnvSearch } from "./views/EnvSearch";

const USAGE_REFRESH_MS = 30_000;
type Sort = { key: string; dir: "asc" | "desc" };

export function K8sWorkspace() {
  const index = useEnvIndex();
  const [env, setEnv] = useTabState<EnvRef | null>("k8s.env", null);
  const [kind, setKind] = useTabState<ResourceKind>("k8s.kind", "pods");
  const [recents, setRecents] = useLocalState<string[]>("k8s.recentEnvs", []);
  const [favourites, setFavourites] = useLocalState<string[]>("k8s.favouriteEnvs", []);
  const [sorts, setSorts] = useTabState<Record<string, Sort>>("k8s.sorts", {});
  const [searching, setSearching] = useState(false);
  const [palette, setPalette] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [lastSelected, setLastSelected] = useState<K8sObject | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [forwarding, setForwarding] = useState(false);
  const [usage, setUsage] = useState<Map<string, Usage>>(new Map());
  const [now, setNow] = useState(Date.now());
  const filterRef = useRef<HTMLInputElement>(null);
  const forwards = useForwards();

  const list = useWatchList(env, kind);
  const ctx: CellContext = useMemo(() => ({ now, usage }), [now, usage]);

  // Keep showing an object that was just deleted, flagged as gone.
  const selected = list.items.find((o) => o.metadata.uid === selectedUid) ?? null;
  useEffect(() => {
    if (selected) setLastSelected(selected);
  }, [selected]);
  const detailObj = selected ?? (selectedUid && lastSelected?.metadata.uid === selectedUid ? lastSelected : null);

  // Sort and filter on every column; show fewer when the detail panel is open.
  const allColumns = useMemo(() => columnsFor(kind), [kind]);
  const columns = useMemo(() => columnsFor(kind, detailObj !== null), [kind, detailObj !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const sort: Sort = sorts[kind] ?? { key: kind === "events" ? "last" : "name", dir: "asc" };
  const sortCol = allColumns.find((c) => c.key === sort.key) ?? allColumns[0];
  const shown = useMemo(
    () => sortObjects(filterObjects(list.items, filter, allColumns, ctx), sortCol, sort.dir, ctx),
    [list.items, filter, allColumns, ctx, sortCol, sort.dir],
  );

  const tier = env ? envTier(env.namespace, env.context) : "other";
  useTabTitle(env ? { label: env.namespace, tier } : null);

  const pick = useCallback(
    (next: EnvRef) => {
      setEnv(next);
      setRecents(pushRecent(recents, envKey(next)));
      setSearching(false);
      setSelectedUid(null);
      setFilter("");
    },
    [recents, setEnv, setRecents],
  );

  const changeKind = useCallback(
    (k: ResourceKind) => {
      setKind(k);
      setSelectedUid(null);
      setFilter("");
    },
    [setKind],
  );

  const openObject = useCallback((uid: string, t: DetailTab) => {
    setSelectedUid(uid);
    setTab(t);
  }, []);
  const openSearch = useCallback(() => setSearching(true), []);

  const toggleFavourite = (key: string) =>
    setFavourites(favourites.includes(key) ? favourites.filter((k) => k !== key) : [key, ...favourites]);

  // Ages tick; CPU/memory refresh while pods or nodes are shown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!env || (kind !== "pods" && kind !== "nodes")) {
      setUsage(new Map());
      return;
    }
    let live = true;
    const load = () =>
      k8s
        .top(env, kind)
        .then((u) => live && setUsage(new Map(u.map((x) => [x.name, x]))))
        .catch(() => live && setUsage(new Map()));
    void load();
    const t = setInterval(load, USAGE_REFRESH_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [env?.context, env?.namespace, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabActive = useTabActive();
  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, .cm-editor, .xterm");
      const key = e.key.toLowerCase();
      if (e.metaKey && !e.ctrlKey && key === "k") {
        e.preventDefault();
        setPalette(true);
      } else if (e.metaKey && key === "e") {
        e.preventDefault();
        setSearching(true);
      } else if (e.metaKey && key === "f" && env && !typing) {
        e.preventDefault();
        filterRef.current?.focus();
      } else if (e.metaKey && key === "r" && env && !typing) {
        e.preventDefault();
        list.reload();
      } else if (e.metaKey && e.ctrlKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const k = ALL_KINDS[Number(e.key) - 1];
        if (k) changeKind(k.kind);
      } else if (e.key === "Escape" && !typing && !palette && !searching && !forwarding) {
        setSelectedUid(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabActive, env, list, changeKind, palette, searching, forwarding]);

  const entries = usePaletteEntries({ env, kind, objects: list.items, recents, favourites, pickEnv: pick, openSearch, changeKind, openObject });

  const search = (
    <EnvSearch
      entries={index.entries}
      contexts={index.contexts}
      namespaces={index.namespaces}
      contextsTotal={index.contexts.length}
      loadingContexts={index.loading}
      errors={index.errors}
      indexError={index.error}
      recents={recents}
      favourites={favourites}
      onToggleFavourite={toggleFavourite}
      onPick={pick}
      onRefresh={() => void index.refresh()}
      onClose={env ? () => setSearching(false) : undefined}
    />
  );

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="glass flex w-60 shrink-0 flex-col border-y-0 border-l-0 px-3 py-4">
        <div className="mb-4">
          <AppSwitcher title="Kubernetes" subtitle="Clusters" />
        </div>
        {env && (
          <button
            onClick={openSearch}
            className="mb-4 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-[var(--line-soft)]"
            style={{ borderColor: isProdLike(tier) ? "rgb(251 113 133 / 0.45)" : "var(--line)" }}
            title="Switch environment (⌘E)"
          >
            <div className="flex items-center gap-2">
              <EnvBadge tier={tier} />
              {favourites.includes(envKey(env)) && <span className="text-[11px] text-amber-300">★</span>}
              <span className="ml-auto text-[10px] text-slate-500">⌘E</span>
            </div>
            <div className="num mt-1.5 truncate text-[13px] font-semibold text-slate-100">{env.namespace}</div>
            <div className="truncate text-[10.5px] text-slate-500">{env.context}</div>
          </button>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {env &&
            KIND_GROUPS.map((g) => (
              <div key={g.title} className="mb-3">
                <div className="label mb-1 px-2">{g.title}</div>
                {g.kinds.map((k) => (
                  <button
                    key={k.kind}
                    onClick={() => changeKind(k.kind)}
                    className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                      kind === k.kind
                        ? "bg-[var(--line)] text-slate-50 shadow-[inset_2px_0_0_var(--acc-400)]"
                        : "text-slate-400 hover:bg-[var(--line-soft)] hover:text-slate-200"
                    }`}
                  >
                    {k.label}
                    {kind === k.kind && !list.loading && <span className="num ml-auto text-[11px] text-slate-500">{list.items.length}</span>}
                  </button>
                ))}
              </div>
            ))}
          <ForwardsList forwards={forwards.forwards} onStop={(id) => void forwards.stop(id)} />
        </div>
        <button className="btn mt-3 text-xs" onClick={() => setPalette(true)}>
          <IconSearch size={13} /> Search <kbd className="chip num ml-auto py-0">⌘K</kbd>
        </button>
      </nav>

      <main className="relative flex min-w-0 flex-1 flex-col">
        {!env ? (
          search
        ) : (
          <>
            {isProdLike(tier) && (
              <div className="flex items-center gap-2 bg-rose-500/10 px-5 py-1.5 text-[11.5px] font-medium text-rose-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-400" />
                Production environment — every change asks for confirmation.
              </div>
            )}
            <header className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-3">
              <h1 className="text-lg font-semibold tracking-tight text-slate-50">{kindLabel(kind)}</h1>
              <span className="num text-xs text-slate-500">{filter ? `${shown.length} of ${list.items.length}` : list.items.length}</span>
              <span className={`flex items-center gap-1.5 text-[11px] ${list.live ? "text-emerald-400" : "text-slate-500"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${list.live ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
                {list.loading ? "Loading…" : list.live ? "Live" : "Reconnecting"}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5">
                  <IconSearch size={13} className="text-slate-500" />
                  <input
                    ref={filterRef}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setFilter("");
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="Filter: name, status, label=value…"
                    className="bare-input w-64 bg-transparent text-[12.5px] text-slate-100 outline-none placeholder:text-slate-600"
                  />
                  <kbd className="chip num py-0">⌘F</kbd>
                </div>
                <button className="btn px-2" onClick={list.reload} title="Reload (⌘R)">
                  <IconRefresh size={14} className={list.loading ? "animate-spin" : ""} />
                </button>
              </div>
            </header>
            {list.error && (
              <p className="mx-5 mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs whitespace-pre-wrap text-rose-300">
                {list.error}
              </p>
            )}
            <div className="flex min-h-0 flex-1 gap-3 px-5 pb-5">
              <div className={`flex min-h-0 min-w-0 flex-col ${detailObj ? "w-[44%] shrink-0" : "flex-1"}`}>
                {list.loading && list.items.length === 0 ? (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }, (_, i) => (
                      <div key={i} className="skeleton h-9" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                  </div>
                ) : list.items.length === 0 && !list.error ? (
                  <div className="glass flex flex-1 flex-col items-center justify-center rounded-2xl text-center">
                    <IconCube size={28} className="text-slate-600" />
                    <p className="mt-3 text-sm text-slate-300">
                      No {kindLabel(kind).toLowerCase()} in {env.namespace}
                    </p>
                  </div>
                ) : (
                  <ResourceTable
                    columns={columns}
                    objects={shown}
                    ctx={ctx}
                    selected={selectedUid}
                    onSelect={(o) => setSelectedUid(o.metadata.uid)}
                    sort={sort}
                    onSort={(key) => setSorts({ ...sorts, [kind]: { key, dir: sort.key === key && sort.dir === "asc" ? "desc" : "asc" } })}
                  />
                )}
              </div>
              {detailObj && (
                <DetailPanel
                  key={detailObj.metadata.uid}
                  env={env}
                  kind={kind}
                  obj={detailObj}
                  usage={usage.get(detailObj.metadata.name)}
                  tab={tab}
                  onTab={setTab}
                  onClose={() => setSelectedUid(null)}
                  onForward={() => setForwarding(true)}
                  gone={!selected}
                />
              )}
            </div>
            {searching && (
              <div className="absolute inset-0 z-40 bg-[var(--bg)]/90 backdrop-blur-md" onClick={() => setSearching(false)}>
                <div className="h-full" onClick={(e) => e.stopPropagation()}>
                  {search}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {palette && <Palette entries={entries} placeholder="Jump to an environment, a resource, logs of a pod…" onClose={() => setPalette(false)} />}
      {forwarding && env && detailObj && (
        <ForwardDialog env={env} kind={kind} obj={detailObj} onClose={() => setForwarding(false)} onStarted={forwards.add} />
      )}
    </div>
  );
}
