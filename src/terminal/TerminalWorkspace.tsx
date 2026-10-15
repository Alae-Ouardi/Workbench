// Terminal workspace: folders in the sidebar, each with its own split layout
// of shells started in that folder. Every folder stays mounted (hidden when
// not shown), so switching folders keeps its shells running.

import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppSwitcher } from "../shell/AppSwitcher";
import { useTabActive, useTabId, useTabState, useTabTitle } from "../shell/TabContext";
import { IconFolder, IconTerminal } from "../shared/icons";
import type { XtermHandle } from "../shared/terminal/XtermView";
import { neighbour, panes } from "./logic/layout";
import { SplitView } from "./SplitView";
import { activeTabOf, terminalStore, useFolders } from "./store";
import { TabStrip } from "./TabStrip";
import type { Direction, TermFolder } from "./types";

// Shells belong to one view: a second Terminal tab offers to take them over.
let owner: string | null = null;
const ownerListeners = new Set<() => void>();
function setOwner(tabId: string | null) {
  owner = tabId;
  ownerListeners.forEach((l) => l());
}
function useOwner(): string | null {
  return useSyncExternalStore(
    (l) => {
      ownerListeners.add(l);
      return () => ownerListeners.delete(l);
    },
    () => owner,
  );
}

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

export function TerminalWorkspace() {
  const tabId = useTabId();
  const currentOwner = useOwner();

  // Claim the shells whenever nobody holds them (also after the owning tab closes).
  useEffect(() => {
    if (currentOwner === null) setOwner(tabId);
  }, [currentOwner, tabId]);
  useEffect(
    () => () => {
      if (owner === tabId) setOwner(null);
    },
    [tabId],
  );

  if (currentOwner !== tabId) {
    if (currentOwner === null) return null;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="glass max-w-sm rounded-2xl p-6 text-center">
          <IconTerminal size={22} className="mx-auto text-slate-400" />
          <p className="mt-3 text-sm text-slate-200">Your terminals are open in another tab.</p>
          <p className="mt-1 text-xs text-slate-500">Moving them here restarts their shells in the same folders.</p>
          <button className="btn btn-primary mt-4" onClick={() => setOwner(tabId)}>
            Move terminals here
          </button>
        </div>
      </div>
    );
  }
  return <Workspace />;
}

function Workspace() {
  const folders = useFolders();
  const tabActive = useTabActive();
  const [activeId, setActiveId] = useTabState<string | null>("terminal.folder", null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handles = useRef(new Map<string, XtermHandle>());

  const active: TermFolder | undefined = folders.find((f) => f.id === activeId) ?? folders[0];
  const tab = active ? activeTabOf(active) : undefined;
  useTabTitle(active ? { label: active.name, tier: "other" } : null);

  async function openFolder() {
    try {
      const picked = await pickFolder({ directory: true, multiple: false, title: "Open a folder in the terminal" });
      if (typeof picked !== "string") return;
      setActiveId(terminalStore.open(picked).id);
    } catch (e) {
      setError(String(e));
    }
  }

  // Keyboard: only while this tab is shown; never keys a shell needs.
  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      // Physical keys: with ⌥ held, e.key is a symbol (⌥⌘W gives "∑").
      const key = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
      // In the rename box (or any field) only ⌘O stays global.
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select") && !(e.target as HTMLElement).closest(".xterm");
      if (typing && key !== "o") return;
      if (e.repeat && (key === "d" || key === "w" || key === "t" || key === "b")) return e.preventDefault();
      const act = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (key === "o" && !e.shiftKey && !e.altKey && !e.ctrlKey) return act(() => void openFolder());
      if (e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
        const f = folders[Number(e.code.slice(5)) - 1];
        return f ? act(() => setActiveId(f.id)) : undefined;
      }
      if (!active || !tab) return;
      // Folder tabs: ⌥⌘T terminal, ⌥⌘B browser, ⌃⌘[ ⌃⌘] previous/next, ⌥⌘1–9 pick.
      if (e.altKey && !e.ctrlKey && key === "t") return act(() => terminalStore.addTab(active.id, "terminal"));
      if (e.altKey && !e.ctrlKey && key === "b") return act(() => terminalStore.addTab(active.id, "browser"));
      if (e.ctrlKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
        return act(() => terminalStore.cycleTab(active.id, e.code === "BracketRight" ? 1 : -1));
      }
      if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
        const t = active.tabs[Number(e.code.slice(5)) - 1];
        return t ? act(() => terminalStore.selectTab(active.id, t.id)) : undefined;
      }
      // Panes inside the tab.
      if (key === "d" && !e.altKey && !e.ctrlKey) return act(() => terminalStore.split(active.id, e.shiftKey ? "col" : "row"));
      if (key === "w" && e.altKey && !e.ctrlKey) return act(() => terminalStore.close(active.id, tab.focused));
      if (key === "k" && !e.shiftKey && !e.altKey && !e.ctrlKey) return act(() => handles.current.get(tab.focused)?.clear());
      if (e.altKey && !e.ctrlKey && ARROWS[e.code]) {
        const next = neighbour(tab.layout, tab.focused, ARROWS[e.code]);
        return next ? act(() => terminalStore.focus(active.id, next)) : act(() => {});
      }
    };
    // Capture: run before the terminal swallows the key.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="flex h-full overflow-hidden" onClick={() => setMenuFor(null)}>
      <nav className="glass flex w-56 shrink-0 flex-col border-y-0 border-l-0 px-3 py-4">
        <div className="mb-5">
          <AppSwitcher title="Terminal" subtitle="Split shells" />
        </div>
        <div className="mb-1.5 flex items-center px-1">
          <span className="label">Folders</span>
          <button className="ml-auto rounded px-1.5 text-[15px] leading-none text-slate-500 hover:text-slate-100" onClick={() => void openFolder()} title="Open folder (⌘O)">
            +
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {folders.map((f, i) => {
            const isActive = f.id === active?.id;
            const count = f.tabs.reduce((n, t) => n + panes(t.layout).length, 0);
            return (
              <li key={f.id} className="relative">
                {renaming === f.id ? (
                  <input
                    autoFocus
                    className="input w-full py-1 text-[12.5px]"
                    defaultValue={f.name}
                    onBlur={(e) => {
                      terminalStore.rename(f.id, e.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setActiveId(f.id)}
                    onDoubleClick={() => setRenaming(f.id)}
                    title={`${f.path}${i < 9 ? `  (⌃⌘${i + 1})` : ""}`}
                    className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] ${
                      isActive ? "bg-[var(--line)] text-slate-50" : "text-slate-400 hover:bg-[var(--line-soft)] hover:text-slate-200"
                    }`}
                  >
                    <IconFolder size={14} className={isActive ? "text-sky-300" : ""} />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="num text-[10px] text-slate-500">{count}</span>
                    <span
                      role="button"
                      tabIndex={-1}
                      className="rounded px-1 text-slate-500 opacity-0 group-hover:opacity-100 hover:text-slate-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(menuFor === f.id ? null : f.id);
                      }}
                      aria-label="Folder actions"
                    >
                      ⋯
                    </span>
                  </button>
                )}
                {menuFor === f.id && (
                  <div className="absolute top-8 right-0 z-30 w-40 overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[var(--panel-solid)] py-1 text-[12px] shadow-xl" onClick={(e) => e.stopPropagation()}>
                    {[
                      { label: "Rename", run: () => setRenaming(f.id) },
                      { label: "Reveal in Finder", run: () => void revealItemInDir(f.path).catch((e) => setError(String(e))) },
                      { label: "Move up", run: () => terminalStore.move(f.id, i - 1) },
                      { label: "Close folder", run: () => terminalStore.remove(f.id) },
                    ].map(({ label, run }) => (
                      <button
                        key={label}
                        className={`block w-full px-3 py-1.5 text-left hover:bg-[var(--line)] ${label === "Close folder" ? "text-rose-300" : "text-slate-300"}`}
                        onClick={() => {
                          setMenuFor(null);
                          run();
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <button className="btn mt-3 w-full justify-center" onClick={() => void openFolder()}>
          + Open folder…
        </button>
        <p className="mt-3 px-1 text-[10.5px] leading-relaxed text-slate-600">
          ⌥⌘T terminal tab · ⌥⌘B browser tab · ⌃⌘[ ] switch tabs · ⌘D / ⇧⌘D split · ⌥⌘W close · ⌥⌘←→↑↓ move · ⌘K clear · ⌃⌘1–9 folders
        </p>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {active && (
          <header className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-4 py-2">
            <IconFolder size={14} className="text-sky-300" />
            <span className="text-[13px] font-medium text-slate-100">{active.name}</span>
            <span className="num truncate text-[11px] text-slate-500" title={active.path}>
              {active.path}
            </span>
            <div className="ml-auto flex gap-1.5">
              <button className="btn py-1 text-xs" onClick={() => terminalStore.split(active.id, "row")} title="Split right (⌘D)">
                Split right
              </button>
              <button className="btn py-1 text-xs" onClick={() => terminalStore.split(active.id, "col")} title="Split down (⇧⌘D)">
                Split down
              </button>
              <button className="btn py-1 text-xs" onClick={() => tab && terminalStore.close(active.id, tab.focused)} title="Close pane (⌥⌘W)">
                Close pane
              </button>
            </div>
          </header>
        )}
        {active && <TabStrip folder={active} />}
        {error && (
          <p className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-1.5 text-xs text-rose-300" onClick={() => setError(null)}>
            {error}
          </p>
        )}
        <div className="relative min-h-0 flex-1 p-1.5">
          {folders.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <IconTerminal size={28} className="mx-auto text-slate-500" />
                <p className="mt-3 text-sm text-slate-300">Open a folder to start a terminal there.</p>
                <p className="mt-1 text-xs text-slate-500">Each folder keeps its own split layout; open as many as you like.</p>
                <button className="btn btn-primary mt-4" onClick={() => void openFolder()}>
                  Open folder… <kbd className="num ml-1 text-[10px] opacity-70">⌘O</kbd>
                </button>
              </div>
            </div>
          ) : (
            <div className="relative h-full w-full">
              {/* Every tab of every folder stays mounted; hidden ones keep running. */}
              {folders.flatMap((f) =>
                f.tabs.map((t) => (
                  <SplitView
                    key={t.id}
                    folderId={f.id}
                    tab={t}
                    visible={tabActive && f.id === active?.id && t.id === f.activeTab}
                    onFocus={(paneId) => terminalStore.focus(f.id, paneId)}
                    onResize={(splitId, ratio) => terminalStore.resize(f.id, splitId, ratio)}
                    onClose={(paneId) => terminalStore.close(f.id, paneId)}
                    register={(paneId, h) => {
                      if (h) handles.current.set(paneId, h);
                      else handles.current.delete(paneId);
                    }}
                  />
                )),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
