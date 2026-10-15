// How many app pop-ups (confirmations, the meeting popup, palettes) are open.
// Browser panes are native views drawn above the page, so they hide while
// any pop-up is shown, or it would appear behind them.

import { useEffect, useSyncExternalStore } from "react";

let open = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Mark a pop-up as open while `active` (and while the component is mounted). */
export function useOverlay(active = true): void {
  useEffect(() => {
    if (!active) return;
    open += 1;
    notify();
    return () => {
      open -= 1;
      notify();
    };
  }, [active]);
}

/** True while any pop-up is open. */
export function useAnyOverlay(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open > 0,
  );
}
