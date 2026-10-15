// What a workspace knows about the tab it lives in: its id (for per-tab
// stored state), whether it is the visible tab (so hidden tabs ignore
// shortcuts), and a way to set the tab's title.

import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { EnvTier } from "../shared/envKind";
import { useLocalState } from "../shared/useLocalState";

export interface TabTitle {
  label: string;
  tier?: EnvTier;
}

interface TabInfo {
  tabId: string;
  active: boolean;
  setTitle: (tabId: string, title: TabTitle | null) => void;
}

const TabContext = createContext<TabInfo>({ tabId: "default", active: true, setTitle: () => {} });

export function TabProvider({ value, children }: { value: TabInfo; children: ReactNode }) {
  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}

/** True while this tab is the one on screen. */
export function useTabActive(): boolean {
  return useContext(TabContext).active;
}

export function useTabId(): string {
  return useContext(TabContext).tabId;
}

/** Name this tab (e.g. the open environment). Cleared when the view unmounts. */
export function useTabTitle(title: TabTitle | null) {
  const { tabId, setTitle } = useContext(TabContext);
  const label = title?.label;
  const tier = title?.tier;
  useEffect(() => {
    setTitle(tabId, label ? { label, tier } : null);
  }, [tabId, label, tier, setTitle]);
  useEffect(() => () => setTitle(tabId, null), [tabId, setTitle]);
}

/** localStorage-backed state scoped to this tab (restored with the tab). */
export function useTabState<T>(key: string, initial: T): [T, (value: T) => void] {
  return useLocalState<T>(`tab.${useTabId()}.${key}`, initial);
}

/** Forget a closed tab's stored state. */
export function clearTabState(tabId: string) {
  try {
    const prefix = `tab.${tabId}.`;
    Object.keys(localStorage)
      .filter((k) => k.startsWith(prefix))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage unavailable: nothing to clean.
  }
}
