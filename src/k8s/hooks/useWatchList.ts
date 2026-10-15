// A live list of one resource kind in one environment: a full list, then a
// kubectl watch that keeps it current. When kubectl ends (server timeouts
// happen) the list is re-read and the watch restarted, backing off after
// errors, so deletions made in between are never missed.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, k8s, onWatch, onWatchEnd } from "../api";
import type { EnvRef, K8sObject, ResourceKind, WatchEvent } from "../types";

const RETRY_MS = [1_000, 3_000, 10_000, 30_000];

function keyOf(o: K8sObject): string {
  return o.metadata.uid || `${o.metadata.namespace ?? ""}/${o.metadata.name}`;
}

export function applyEvents(current: Map<string, K8sObject>, events: WatchEvent[]): Map<string, K8sObject> {
  const next = new Map(current);
  for (const e of events) {
    if (!e.object?.metadata) continue;
    if (e.type === "DELETED") next.delete(keyOf(e.object));
    else if (e.type === "ADDED" || e.type === "MODIFIED") next.set(keyOf(e.object), e.object);
  }
  return next;
}

export function useWatchList(env: EnvRef | null, kind: ResourceKind) {
  const [items, setItems] = useState<Map<string, K8sObject>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [generation, setGeneration] = useState(0);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!env) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const unlisten: (() => void)[] = [];
    // Events for a watch whose id isn't known yet (the start call is still
    // returning) are kept and replayed once it is.
    const early = new Map<number, { events: WatchEvent[]; ended?: string | null }>();
    setItems(new Map());
    setLoading(true);
    setError(null);
    setLive(false);

    const onEnd = (message: string | null) => {
      watchId.current = null;
      setLive(false);
      if (message) setError(message);
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
      attempt += 1;
      retry = setTimeout(() => void sync(), delay);
    };

    const sync = async () => {
      try {
        const list = await k8s.list(env, kind);
        if (cancelled) return;
        setItems(new Map(list.map((o) => [keyOf(o), o])));
      } catch (e) {
        if (!cancelled) setError(errorText(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled) return;
      try {
        const id = await k8s.watchStart(env, kind);
        if (cancelled) return void k8s.watchStop(id);
        watchId.current = id;
        setLive(true);
        const buffered = early.get(id);
        early.clear();
        if (buffered?.events.length) setItems((current) => applyEvents(current, buffered.events));
        if (buffered && "ended" in buffered) onEnd(buffered.ended ?? null);
      } catch (e) {
        if (!cancelled) onEnd(errorText(e));
      }
    };

    (async () => {
      const stopEvents = await onWatch((id, events) => {
        if (cancelled) return;
        if (id === watchId.current) {
          attempt = 0;
          setError(null);
          setItems((current) => applyEvents(current, events));
        } else if (watchId.current === null) {
          const entry = early.get(id) ?? { events: [] };
          entry.events.push(...events);
          early.set(id, entry);
        }
      });
      if (cancelled) return stopEvents();
      unlisten.push(stopEvents);
      const stopEnds = await onWatchEnd((id, message) => {
        if (cancelled) return;
        if (id === watchId.current) onEnd(message);
        else if (watchId.current === null) early.set(id, { ...(early.get(id) ?? { events: [] }), ended: message });
      });
      if (cancelled) return stopEnds();
      unlisten.push(stopEnds);
      await sync();
    })();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      unlisten.forEach((u) => u());
      if (watchId.current !== null) void k8s.watchStop(watchId.current);
      watchId.current = null;
    };
  }, [env?.context, env?.namespace, kind, generation]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  return { items: [...items.values()], loading, error, live, reload };
}
