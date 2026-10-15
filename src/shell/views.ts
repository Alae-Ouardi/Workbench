// Which views the user turned off in Settings. Saved on this Mac and shared by
// Home, the app switcher and the tabs. Home itself can never be hidden, and at
// least one view always stays on.

import { useSyncExternalStore } from "react";
import type { AppMode } from "./AppSwitcher";

export const APP_MODES: readonly AppMode[] = ["taskboard", "tp", "k8s", "db", "calendar", "terminal"];

const KEY = "shell.hiddenViews";

/** Keep only known views, never all of them. */
export function restoreHidden(raw: unknown): AppMode[] {
  if (!Array.isArray(raw)) return [];
  const hidden = APP_MODES.filter((m) => raw.includes(m));
  return hidden.length === APP_MODES.length ? [] : hidden;
}

export function visibleModes(hidden: readonly AppMode[]): AppMode[] {
  return APP_MODES.filter((m) => !hidden.includes(m));
}

/** Turn a view on or off; turning off the last visible view is refused. */
export function setHidden(hidden: readonly AppMode[], mode: AppMode, hide: boolean): AppMode[] {
  if (!hide) return hidden.filter((m) => m !== mode);
  if (hidden.includes(mode) || visibleModes(hidden).length <= 1) return [...hidden];
  return APP_MODES.filter((m) => m === mode || hidden.includes(m));
}

function load(): AppMode[] {
  try {
    return restoreHidden(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

let hiddenViews: AppMode[] = load();
const listeners = new Set<() => void>();

export function useHiddenViews(): AppMode[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hiddenViews,
  );
}

export function toggleView(mode: AppMode, hide: boolean) {
  const next = setHidden(hiddenViews, mode, hide);
  if (next.length === hiddenViews.length && next.every((m, i) => m === hiddenViews[i])) return;
  hiddenViews = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
  listeners.forEach((l) => l());
}
