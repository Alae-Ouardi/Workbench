// Tab model: an ordered list of tabs, one active. Pure functions so the
// behaviour (where a new tab lands, what gets focus on close) is testable.

import type { Screen } from "./AppSwitcher";

export interface Tab {
  id: string;
  screen: Screen;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string;
}

export const MAX_TABS = 20;

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function initialTabs(id: string = newId()): TabsState {
  return { tabs: [{ id, screen: "home" }], activeId: id };
}

/** Open a tab right after the active one and focus it. */
export function openTab(state: TabsState, screen: Screen, id: string = newId()): TabsState {
  if (state.tabs.length >= MAX_TABS) return state;
  const at = state.tabs.findIndex((t) => t.id === state.activeId) + 1;
  const tabs = [...state.tabs.slice(0, at), { id, screen }, ...state.tabs.slice(at)];
  return { tabs, activeId: id };
}

/** Close a tab; focus moves to its right neighbour, else its left. The last tab becomes a fresh Home tab. */
export function closeTab(state: TabsState, id: string, freshId: string = newId()): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (tabs.length === 0) return initialTabs(freshId);
  if (state.activeId !== id) return { ...state, tabs };
  const next = tabs[Math.min(index, tabs.length - 1)];
  return { tabs, activeId: next.id };
}

export function selectTab(state: TabsState, id: string): TabsState {
  return state.tabs.some((t) => t.id === id) ? { ...state, activeId: id } : state;
}

/** ⌘1…⌘8 pick that position, ⌘9 the last tab (like browsers). */
export function selectByNumber(state: TabsState, n: number): TabsState {
  const tab = n === 9 ? state.tabs[state.tabs.length - 1] : state.tabs[n - 1];
  return tab ? { ...state, activeId: tab.id } : state;
}

export function cycleTab(state: TabsState, step: 1 | -1): TabsState {
  const i = state.tabs.findIndex((t) => t.id === state.activeId);
  const next = state.tabs[(i + step + state.tabs.length) % state.tabs.length];
  return { ...state, activeId: next.id };
}

/** Change what the active tab shows (Home card picked, app switcher). */
export function setScreen(state: TabsState, id: string, screen: Screen): TabsState {
  return { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, screen } : t)) };
}

export function moveTab(state: TabsState, id: string, toIndex: number): TabsState {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from === -1) return state;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
  return { ...state, tabs };
}

const SCREENS: Screen[] = ["home", "taskboard", "tp", "k8s", "db", "calendar", "terminal"];

/** Validate a stored state; anything unusable falls back to one Home tab. */
export function restoreTabs(raw: unknown): TabsState {
  const value = raw as Partial<TabsState> | null;
  const tabs = Array.isArray(value?.tabs)
    ? value!.tabs.filter((t): t is Tab => typeof t?.id === "string" && SCREENS.includes(t.screen)).slice(0, MAX_TABS)
    : [];
  if (tabs.length === 0) return initialTabs();
  const activeId = tabs.some((t) => t.id === value?.activeId) ? value!.activeId! : tabs[0].id;
  return { tabs, activeId };
}

/** Tabs showing a view that was just hidden go back to Home. */
export function homeHiddenTabs(state: TabsState, hidden: readonly Screen[]): TabsState {
  if (!state.tabs.some((t) => hidden.includes(t.screen))) return state;
  return { ...state, tabs: state.tabs.map((t) => (hidden.includes(t.screen) ? { ...t, screen: "home" } : t)) };
}
