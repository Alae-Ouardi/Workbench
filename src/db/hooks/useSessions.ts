// Open database sessions (shared by every tab: they live in the backend) and
// the step-by-step progress of connections being opened.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "../../k8s/api";
import { db, onConnectStep, onSessionEnd } from "../api";
import type { ConnectStep, SessionInfo, StepName } from "../types";

export const STEPS: { name: StepName; label: string }[] = [
  { name: "secret", label: "Read credentials from the cluster secret" },
  { name: "pod", label: "Start the relay pod" },
  { name: "ready", label: "Wait for the relay pod" },
  { name: "forward", label: "Open the local tunnel" },
  { name: "database", label: "Connect to MySQL" },
];

export interface Progress {
  steps: Partial<Record<StepName, ConnectStep>>;
  error: string | null;
  busy: boolean;
}

/** `active`: refresh the shared session list whenever this tab is shown. */
export function useSessions(active = true) {
  const [sessions, setSessions] = useState<Record<string, SessionInfo>>({});
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [ended, setEnded] = useState<Record<string, string>>({});
  // Connections this tab is opening; other tabs' progress events are ignored.
  const mine = useRef(new Set<string>());

  const refresh = useCallback(
    () => void db.sessions().then((list) => setSessions(Object.fromEntries(list.map((s) => [s.connection_id, s])))),
    [],
  );

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  useEffect(() => {
    const unlisten = [
      onConnectStep((step) => {
        if (!mine.current.has(step.connection_id)) {
          // Opened from another tab: just pick up the new session.
          if (step.step === "database" && step.state === "done") setTimeout(refresh, 300);
          return;
        }
        if (step.detail === "cancelled") return;
        setProgress((p) => {
          // A late event for an attempt already over (cancelled) changes nothing.
          const current = p[step.connection_id];
          if (!current) return p;
          return { ...p, [step.connection_id]: { ...current, steps: { ...current.steps, [step.step]: step } } };
        });
      }),
      onSessionEnd((id, reason) => {
        setSessions(({ [id]: _closed, ...rest }) => rest);
        if (reason === "expired") setEnded((e) => ({ ...e, [id]: "The tunnel closed after an hour. Reconnect to continue." }));
        if (reason === "tunnel-lost") setEnded((e) => ({ ...e, [id]: "The tunnel dropped (network or cluster). Reconnect to continue." }));
      }),
    ];
    return () => unlisten.forEach((p) => void p.then((u) => u()));
  }, [refresh]);

  const connect = useCallback(async (id: string) => {
    setEnded(({ [id]: _old, ...rest }) => rest);
    setProgress((p) => ({ ...p, [id]: { steps: {}, error: null, busy: true } }));
    mine.current.add(id);
    try {
      const info = await db.connect(id);
      setSessions((s) => ({ ...s, [id]: info }));
      setProgress((p) => ({ ...p, [id]: { ...p[id], busy: false } }));
      return info;
    } catch (e) {
      const text = errorText(e);
      // A cancelled attempt leaves no error behind, just the Connect button.
      if (text === "cancelled") setProgress(({ [id]: _p, ...rest }) => rest);
      else setProgress((p) => ({ ...p, [id]: { ...(p[id] ?? { steps: {} }), error: text, busy: false } }));
      return null;
    } finally {
      mine.current.delete(id);
    }
  }, []);

  const disconnect = useCallback(async (id: string) => {
    await db.disconnect(id);
    setSessions(({ [id]: _closed, ...rest }) => rest);
    setProgress(({ [id]: _p, ...rest }) => rest);
  }, []);

  const cancel = useCallback((id: string) => void db.cancelConnect(id), []);

  return { sessions, progress, ended, connect, cancel, disconnect };
}
