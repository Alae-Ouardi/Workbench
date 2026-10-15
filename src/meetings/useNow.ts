import { useEffect, useMemo, useState } from "react";

/** Current time in ms, refreshed every `everyMs` (default 1s) while `active`. */
export function useNow(active: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}

/** Local midnight of today; moves on when the day changes. */
export function useToday(): Date {
  const now = useNow(true, 60_000);
  const d = new Date(now);
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => new Date(d.getFullYear(), d.getMonth(), d.getDate()), [key]);
}
