// The environment index: every context and its namespaces. Cached in
// localStorage so the search is instant on launch, refreshed in the
// background (a few contexts at a time — each call runs the login plugin).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, k8s } from "../api";
import { buildEntries, type EnvEntry } from "../logic/envSearch";
import type { ContextInfo } from "../types";

interface IndexState {
  contexts: ContextInfo[];
  namespaces: Record<string, string[]>;
  errors: Record<string, string>;
  fetchedAt: number | null;
}

const STORAGE_KEY = "k8s.envIndex.v1";
const MAX_AGE_MS = 30 * 60 * 1000;
const PARALLEL = 4;

const EMPTY: IndexState = { contexts: [], namespaces: {}, errors: {}, fetchedAt: null };

/** Refresh at most once per app launch, however many Kubernetes tabs open. */
let refreshedThisLaunch = false;

function load(): IndexState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const valid =
      raw &&
      Array.isArray(raw.contexts) &&
      raw.contexts.every((c: unknown) => typeof (c as ContextInfo)?.name === "string") &&
      typeof raw.namespaces === "object" &&
      Object.values(raw.namespaces ?? {}).every((v) => Array.isArray(v));
    if (valid) return { ...EMPTY, ...raw, errors: raw.errors ?? {} } as IndexState;
  } catch {
    // Unreadable cache: rebuild it.
  }
  return EMPTY;
}

function save(state: IndexState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the index still works for this session.
  }
}

export function useEnvIndex() {
  const [state, setState] = useState<IndexState>(load);
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    try {
      const contexts = await k8s.contexts();
      setState((s) => ({ ...s, contexts }));
      setLoading(new Set(contexts.map((c) => c.name)));
      const queue = [...contexts];
      const worker = async () => {
        for (let c = queue.shift(); c; c = queue.shift()) {
          const name = c.name;
          try {
            const ns = await k8s.namespaces(name);
            setState((s) => {
              const errors = { ...s.errors };
              delete errors[name];
              return { ...s, namespaces: { ...s.namespaces, [name]: ns }, errors };
            });
          } catch (e) {
            // Listing namespaces may be forbidden: keep the context's own
            // default namespace so it can still be opened.
            setState((s) => ({
              ...s,
              namespaces: { ...s.namespaces, [name]: s.namespaces[name] ?? (c!.namespace ? [c!.namespace] : []) },
              errors: { ...s.errors, [name]: errorText(e) },
            }));
          } finally {
            setLoading((l) => {
              const next = new Set(l);
              next.delete(name);
              return next;
            });
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      setState((s) => {
        const known = new Set(contexts.map((c) => c.name));
        const namespaces = Object.fromEntries(Object.entries(s.namespaces).filter(([k]) => known.has(k)));
        const next = { ...s, namespaces, fetchedAt: Date.now() };
        save(next);
        return next;
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    const stale = !state.fetchedAt || Date.now() - state.fetchedAt > MAX_AGE_MS;
    if (!refreshedThisLaunch || (stale && !running.current)) {
      refreshedThisLaunch = true;
      void refresh();
    }
    // Only on mount; later refreshes are manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entries: EnvEntry[] = useMemo(() => buildEntries(state.namespaces), [state.namespaces]);

  return { ...state, entries, loading, error, refresh };
}
