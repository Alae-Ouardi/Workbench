// App-wide meeting state: the live call, meetings waiting to be logged and
// the settings. Mounted once at the root so the popup can appear over any
// tab, and the indicator and Meetings view share one source of truth.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { meetingsApi, onMeetingEnded, onMeetingState, onMeetingsChanged, onOpenPopup } from "./api";
import { MeetingPopup } from "./MeetingPopup";
import type { LiveState, LoggedMeeting, MeetingSettings, PendingMeeting } from "./types";

interface MeetingsValue {
  live: LiveState;
  pending: PendingMeeting[];
  logged: LoggedMeeting[];
  settings: MeetingSettings | null;
  saveSettings: (s: MeetingSettings) => Promise<MeetingSettings>;
  split: () => Promise<void>;
  stop: () => Promise<void>;
  /** Open the logging popup, on a given meeting or the oldest waiting one. */
  openPopup: (id?: string) => void;
}

const IDLE: LiveState = { active: false, started_at: null, apps: [], suppressed: false };

const MeetingsContext = createContext<MeetingsValue | null>(null);

export function useMeetings(): MeetingsValue {
  const value = useContext(MeetingsContext);
  if (!value) throw new Error("useMeetings outside MeetingProvider");
  return value;
}

/**
 * `showPopup` is off in the menu-bar panel, which logs meetings inline; the
 * main window asks the full popup to open via `meeting-open-popup`.
 */
export function MeetingProvider({ children, showPopup = true }: { children: ReactNode; showPopup?: boolean }) {
  const [live, setLive] = useState<LiveState>(IDLE);
  const [pending, setPending] = useState<PendingMeeting[]>([]);
  const [logged, setLogged] = useState<LoggedMeeting[]>([]);
  const [settings, setSettings] = useState<MeetingSettings | null>(null);
  // The meeting shown in the popup. Held as a copy: while it is being logged
  // it has already left the pending list.
  const [popup, setPopup] = useState<PendingMeeting | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  /** The meeting this window's popup is logging right now. */
  const loggingRef = useRef<string | null>(null);
  const onLogging = useCallback((id: string | null) => {
    loggingRef.current = id;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const unlisten = [
      onMeetingState((s) => setLive(s)),
      onMeetingsChanged((o) => {
        setLive(o.live);
        setPending(o.pending);
        setLogged(o.logged);
        // Logged or ignored elsewhere (the menu-bar panel): close our popup,
        // unless it is this popup's own log in flight.
        setPopup((shown) =>
          shown && loggingRef.current !== shown.id && !o.pending.some((p) => p.id === shown.id) ? null : shown,
        );
      }),
      // Don't replace a popup the user is filling in; the counter shows the new one.
      onMeetingEnded((m) => setPopup((shown) => shown ?? m)),
      onOpenPopup((id) => setPopup((shown) => shown ?? pendingRef.current.find((p) => p.id === id) ?? null)),
    ];
    meetingsApi
      .overview()
      .then((o) => {
        if (cancelled) return;
        setLive(o.live);
        setPending(o.pending);
        setLogged(o.logged);
        // Meetings left unlogged last time: ask again on launch.
        if (o.pending.length) setPopup((shown) => shown ?? o.pending[0]);
      })
      .catch((e) => console.error("meetings overview", e));
    meetingsApi
      .settings()
      .then((s) => !cancelled && setSettings(s))
      .catch((e) => console.error("meeting settings", e));
    return () => {
      cancelled = true;
      unlisten.forEach((p) => void p.then((u) => u()));
    };
  }, []);

  const saveSettings = useCallback(async (s: MeetingSettings) => {
    const saved = await meetingsApi.saveSettings(s);
    setSettings(saved);
    return saved;
  }, []);

  const openPopup = useCallback(
    (id?: string) => setPopup(pending.find((p) => p.id === id) ?? pending[0] ?? null),
    [pending],
  );

  const value = useMemo<MeetingsValue>(
    () => ({ live, pending, logged, settings, saveSettings, split: meetingsApi.split, stop: meetingsApi.stop, openPopup }),
    [live, pending, logged, settings, saveSettings, openPopup],
  );

  const onDone = useCallback(
    (doneId: string) => setPopup(pendingRef.current.find((p) => p.id !== doneId) ?? null),
    [],
  );
  const onLater = useCallback(() => setPopup(null), []);
  const others = popup ? pending.filter((p) => p.id !== popup.id) : [];

  return (
    <MeetingsContext.Provider value={value}>
      {children}
      {showPopup && popup && settings && (
        <MeetingPopup
          key={popup.id}
          meeting={popup}
          waiting={others.length}
          settings={settings}
          // After logging or ignoring, move on to the next waiting meeting.
          onDone={onDone}
          onLater={onLater}
          onLogging={onLogging}
        />
      )}
    </MeetingsContext.Provider>
  );
}
