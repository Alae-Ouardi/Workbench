// The Terminal workspace's folders, their tabs and split layouts, shared by
// every view of it and saved to localStorage (shells are not saved; they
// restart in place).

import { useSyncExternalStore } from "react";
import { closePane, findPane, newId, newPane, panes, restoreFolders, setRatio, splitPane, updatePane } from "./logic/layout";
import type { PaneView, SplitDir, TermFolder, TermTab } from "./types";

const KEY = "terminal.folders";

function load(): TermFolder[] {
  try {
    return restoreFolders(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
  } catch {
    return [];
  }
}

let folders: TermFolder[] = load();
const listeners = new Set<() => void>();

function set(next: TermFolder[]) {
  folders = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the layout still works for this session.
  }
  listeners.forEach((l) => l());
}

function update(id: string, fn: (f: TermFolder) => TermFolder) {
  set(folders.map((f) => (f.id === id ? fn(f) : f)));
}

function newTab(path: string, view: PaneView): TermTab {
  const first = newPane(path, view);
  return { id: newId("t"), layout: first, focused: first.id };
}

export function activeTabOf(f: TermFolder): TermTab {
  return f.tabs.find((t) => t.id === f.activeTab) ?? f.tabs[0];
}

/** Change the tab holding `paneId` (or the active tab). */
function updateTab(f: TermFolder, fn: (t: TermTab) => TermTab, paneId?: string): TermFolder {
  const target = paneId ? f.tabs.find((t) => findPane(t.layout, paneId)) : activeTabOf(f);
  if (!target) return f;
  return { ...f, tabs: f.tabs.map((t) => (t.id === target.id ? fn(t) : t)) };
}

/** Remove a tab; its neighbour becomes active, and a folder is never left empty. */
function withoutTab(f: TermFolder, tabId: string): TermFolder {
  const at = f.tabs.findIndex((t) => t.id === tabId);
  const tabs = f.tabs.filter((t) => t.id !== tabId);
  if (!tabs.length) {
    const fresh = newTab(f.path, "terminal");
    return { ...f, tabs: [fresh], activeTab: fresh.id };
  }
  const activeTab = f.activeTab !== tabId ? f.activeTab : tabs[Math.min(at, tabs.length - 1)].id;
  return { ...f, tabs, activeTab };
}

export function useFolders(): TermFolder[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => folders,
  );
}

export const terminalStore = {
  /** Add a folder (or return the existing one for the same path). */
  open(path: string): TermFolder {
    const existing = folders.find((f) => f.path === path);
    if (existing) return existing;
    const tab = newTab(path, "terminal");
    const folder: TermFolder = {
      id: newId("f"),
      path,
      name: path.split("/").filter(Boolean).pop() || path,
      tabs: [tab],
      activeTab: tab.id,
    };
    set([...folders, folder]);
    return folder;
  },
  remove(id: string) {
    set(folders.filter((f) => f.id !== id));
  },
  rename(id: string, name: string) {
    update(id, (f) => ({ ...f, name: name.trim() || f.name }));
  },
  move(id: string, toIndex: number) {
    const list = [...folders];
    const from = list.findIndex((f) => f.id === id);
    if (from < 0) return;
    const [f] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, f);
    set(list);
  },

  // ---- tabs
  /** A new terminal or browser tab, opened right after the current one. */
  addTab(id: string, view: PaneView) {
    update(id, (f) => {
      const tab = newTab(f.path, view);
      const tabs = [...f.tabs];
      tabs.splice(f.tabs.findIndex((t) => t.id === f.activeTab) + 1, 0, tab);
      return { ...f, tabs, activeTab: tab.id };
    });
  },
  closeTab(id: string, tabId: string) {
    update(id, (f) => withoutTab(f, tabId));
  },
  selectTab(id: string, tabId: string) {
    update(id, (f) => (f.activeTab === tabId || !f.tabs.some((t) => t.id === tabId) ? f : { ...f, activeTab: tabId }));
  },
  /** Next (1) or previous (-1) tab, wrapping around. */
  cycleTab(id: string, step: number) {
    update(id, (f) => {
      const at = f.tabs.findIndex((t) => t.id === f.activeTab);
      return { ...f, activeTab: f.tabs[(at + step + f.tabs.length) % f.tabs.length].id };
    });
  },
  renameTab(id: string, tabId: string, title: string) {
    update(id, (f) => ({ ...f, tabs: f.tabs.map((t) => (t.id === tabId ? { ...t, title: title.trim() || undefined } : t)) }));
  },
  moveTab(id: string, tabId: string, toIndex: number) {
    update(id, (f) => {
      const tabs = [...f.tabs];
      const from = tabs.findIndex((t) => t.id === tabId);
      if (from < 0) return f;
      const [t] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, t);
      return { ...f, tabs };
    });
  },

  // ---- panes (in the tab that holds them, or the active tab)
  focus(id: string, paneId: string) {
    update(id, (f) => updateTab(f, (t) => (t.focused === paneId ? t : { ...t, focused: paneId }), paneId));
  },
  /** Split the active tab's focused pane with another of the same kind
   *  (a terminal tab gets a terminal, a browser tab a browser). */
  split(id: string, dir: SplitDir) {
    update(id, (f) =>
      updateTab(f, (t) => {
        const from = findPane(t.layout, t.focused);
        const added = newPane(from?.cwd ?? f.path, panes(t.layout)[0]?.view ?? "terminal");
        return { ...t, layout: splitPane(t.layout, t.focused, dir, added), focused: added.id };
      }),
    );
  },
  /** Close a pane; closing a tab's last pane closes the tab. */
  close(id: string, paneId: string) {
    update(id, (f) => {
      const tab = f.tabs.find((t) => findPane(t.layout, paneId));
      if (!tab) return f;
      const next = closePane(tab.layout, paneId);
      if (!next) return withoutTab(f, tab.id);
      const order = panes(tab.layout).map((p) => p.id);
      const remaining = panes(next).map((p) => p.id);
      const focused = tab.focused !== paneId ? tab.focused : remaining[Math.min(order.indexOf(paneId), remaining.length - 1)];
      return { ...f, tabs: f.tabs.map((t) => (t.id === tab.id ? { ...t, layout: next, focused } : t)) };
    });
  },
  resize(id: string, splitId: string, ratio: number) {
    update(id, (f) => ({ ...f, tabs: f.tabs.map((t) => ({ ...t, layout: setRatio(t.layout, splitId, ratio) })) }));
  },
  /** Remember a browser pane's page (restored on relaunch) and its title. */
  setPage(id: string, paneId: string, patch: { url?: string; title?: string }) {
    update(id, (f) => updateTab(f, (t) => ({ ...t, layout: updatePane(t.layout, paneId, patch) }), paneId));
  },
};
