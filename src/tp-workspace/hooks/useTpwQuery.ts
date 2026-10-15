import { useCallback, useEffect, useRef, useState } from "react";
import { tpwQuery } from "../api";
import type { TpwQuery } from "../types";

/** Fired to make every mounted query refetch from TargetProcess. */
export const REFRESH_EVENT = "tpw:refresh";

export function requestRefresh(): void {
  window.dispatchEvent(new Event(REFRESH_EVENT));
}

export interface QueryState<T> {
  data: T | null;
  fetchedAt: string | null;
  /** No data yet, cached or live. */
  loading: boolean;
  /** A live fetch is in flight (data may already be shown from cache). */
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Stale-while-revalidate over the Rust cache: show the cached snapshot
 * instantly, then replace it with a live fetch. `null` query = disabled.
 */
export function useTpwQuery<T>(query: TpwQuery | null): QueryState<T> {
  const key = query ? JSON.stringify(query) : null;
  const [data, setData] = useState<T | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(query !== null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slow response for an old key overwriting a newer one.
  const activeKey = useRef<string | null>(null);

  const fetchFresh = useCallback(async (k: string) => {
    setRefreshing(true);
    try {
      const result = await tpwQuery<T>(JSON.parse(k) as TpwQuery, true);
      if (activeKey.current !== k) return;
      if (result) {
        setData(result.payload);
        setFetchedAt(result.fetched_at);
      }
      setError(null);
    } catch (e) {
      if (activeKey.current === k) setError(String(e));
    } finally {
      if (activeKey.current === k) {
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    activeKey.current = key;
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    tpwQuery<T>(JSON.parse(key) as TpwQuery, false)
      .then((cached) => {
        if (activeKey.current !== key || !cached) return;
        setData(cached.payload);
        setFetchedAt(cached.fetched_at);
        setLoading(false);
      })
      .catch(() => {
        // A cache miss or unreadable cache is not worth surfacing; the live
        // fetch below reports any real problem.
      })
      .finally(() => void fetchFresh(key));
  }, [key, fetchFresh]);

  useEffect(() => {
    if (!key) return;
    const onRefresh = () => void fetchFresh(key);
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [key, fetchFresh]);

  const refresh = useCallback(() => {
    if (key) void fetchFresh(key);
  }, [key, fetchFresh]);

  return { data, fetchedAt, loading, refreshing, error, refresh };
}
