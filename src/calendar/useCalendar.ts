// Calendar access and the events of a date range, kept fresh: reloaded on
// window focus and every few minutes (macOS syncs Exchange in the background).

import { useCallback, useEffect, useRef, useState } from "react";
import { calendarApi } from "./api";
import type { Access, CalEvent } from "./types";

const REFRESH_MS = 3 * 60_000;

export function useCalendarAccess() {
  const [access, setAccess] = useState<Access | null>(null);
  // Re-read on focus: access may have been allowed in System Settings.
  useEffect(() => {
    const check = () => calendarApi.access().then(setAccess).catch(() => setAccess("denied"));
    void check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  const request = useCallback(async () => {
    setAccess(await calendarApi.requestAccess().catch(() => "denied" as const));
  }, []);
  return { access, request };
}

export function useCalendarEvents(from: Date, to: Date, enabled: boolean) {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  // Only the latest request may update state (an older, slower one for the
  // previous week must not overwrite the current one).
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    const request = ++latest.current;
    setLoading(true);
    try {
      const found = await calendarApi.events(new Date(fromMs), new Date(toMs));
      if (request !== latest.current) return;
      setEvents(found);
      setError(null);
    } catch (e) {
      if (request === latest.current) setError(String(e));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [enabled, fromMs, toMs]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  return { events, loading, error, reload: load };
}
