import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import App from "./App";
import { CalendarWorkspace } from "./calendar/CalendarWorkspace";
import { DbWorkspace } from "./db/DbWorkspace";
import { K8sWorkspace } from "./k8s/K8sWorkspace";
import { MeetingProvider } from "./meetings/MeetingProvider";
import { AppNavProvider, type Screen } from "./shell/AppSwitcher";
import { Home, type AppMode } from "./shell/Home";
import { TabBar } from "./shell/TabBar";
import { useHiddenViews } from "./shell/views";
import { clearTabState, TabProvider, type TabTitle } from "./shell/TabContext";
import { closeTab, cycleTab, homeHiddenTabs, moveTab, openTab, restoreTabs, selectByNumber, selectTab, setScreen, type TabsState } from "./shell/tabs";
import { ConfirmProvider } from "./shared/confirm/ConfirmProvider";
import { PrefsProvider, useLocalState } from "./tp-workspace/prefs";
import { TerminalWorkspace } from "./terminal/TerminalWorkspace";
import { TpWorkspace } from "./tp-workspace/TpWorkspace";

const TABS_KEY = "shell.tabs";
const TITLES_KEY = "shell.tabTitles";

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: tabs just won't be restored next launch.
  }
}

export default function Root() {
  return (
    <PrefsProvider>
      <ConfirmProvider>
        <MeetingProvider>
          <Tabs />
        </MeetingProvider>
      </ConfirmProvider>
    </PrefsProvider>
  );
}

function Tabs() {
  const [state, setState] = useState<TabsState>(() => restoreTabs(load(TABS_KEY)));
  const [titles, setTitles] = useState<Record<string, TabTitle>>(() => load(TITLES_KEY) ?? {});
  const [last, setLast] = useLocalState<AppMode>("shell.lastMode", "taskboard");

  const current = useRef(state);
  current.current = state;
  useEffect(() => store(TABS_KEY, state), [state]);
  useEffect(() => store(TITLES_KEY, titles), [titles]);

  const update = useCallback((fn: (s: TabsState) => TabsState) => setState(fn), []);

  // A view turned off in Settings: tabs showing it go back to Home.
  const hidden = useHiddenViews();
  useEffect(() => update((s) => homeHiddenTabs(s, hidden)), [hidden, update]);

  const close = useCallback((id: string) => {
    clearTabState(id);
    setTitles(({ [id]: _closed, ...rest }) => rest);
    setState((s) => closeTab(s, id));
  }, []);

  const setTitle = useCallback((tabId: string, title: TabTitle | null) => {
    setTitles((all) => {
      const current = all[tabId];
      if (!title) {
        if (!current) return all;
        const { [tabId]: _gone, ...rest } = all;
        return rest;
      }
      return current?.label === title.label && current?.tier === title.tier ? all : { ...all, [tabId]: title };
    });
  }, []);

  // ⌘T / ⌘W / ⌃Tab come from the app menu (so ⌘W never closes the window).
  useEffect(() => {
    const unlisten = listen<{ action: "new" | "close" | "next" | "prev" }>("menu-tab", (e) => {
      const action = e.payload.action;
      if (action === "new") update((s) => openTab(s, "home"));
      else if (action === "next") update((s) => cycleTab(s, 1));
      else if (action === "prev") update((s) => cycleTab(s, -1));
      else close(current.current.activeId);
    });
    return () => void unlisten.then((u) => u());
  }, [update, close]);

  // ⌘1–⌘9 pick a tab; ⌘⇧[ / ⌘⇧] cycle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        update((s) => selectByNumber(s, Number(e.key)));
      } else if (e.shiftKey && (e.key === "]" || e.key === "}")) {
        e.preventDefault();
        update((s) => cycleTab(s, 1));
      } else if (e.shiftKey && (e.key === "[" || e.key === "{")) {
        e.preventDefault();
        update((s) => cycleTab(s, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [update]);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TabBar
        tabs={state.tabs}
        activeId={state.activeId}
        titles={titles}
        onSelect={(id) => update((s) => selectTab(s, id))}
        onClose={close}
        onNew={() => update((s) => openTab(s, "home"))}
        onMove={(id, to) => update((s) => moveTab(s, id, to))}
      />
      <div className="relative min-h-0 flex-1">
        {state.tabs.map((tab) => (
          <TabPane
            key={tab.id}
            tabId={tab.id}
            screen={tab.screen}
            active={tab.id === state.activeId}
            last={last}
            setTitle={setTitle}
            onScreen={(screen) => {
              if (screen !== "home") setLast(screen);
              update((s) => setScreen(s, tab.id, screen));
            }}
            onOpenNew={(screen) => update((s) => openTab(s, screen))}
          />
        ))}
      </div>
    </div>
  );
}

function TabPane({
  tabId,
  screen,
  active,
  last,
  setTitle,
  onScreen,
  onOpenNew,
}: {
  tabId: string;
  screen: Screen;
  active: boolean;
  last: AppMode;
  setTitle: (tabId: string, title: TabTitle | null) => void;
  onScreen: (screen: Screen) => void;
  onOpenNew: (screen: Screen) => void;
}) {
  const nav = useMemo(() => ({ current: screen, go: onScreen, openNew: onOpenNew }), [screen, onScreen, onOpenNew]);
  const tab = useMemo(() => ({ tabId, active, setTitle }), [tabId, active, setTitle]);
  return (
    // Hidden tabs stay mounted so they keep their state (streams, scroll, edits).
    <div className="absolute inset-0" style={{ display: active ? "block" : "none" }}>
      <TabProvider value={tab}>
        <AppNavProvider value={nav}>
          {screen === "taskboard" ? (
            <App />
          ) : screen === "tp" ? (
            <TpWorkspace onHome={() => onScreen("home")} />
          ) : screen === "k8s" ? (
            <K8sWorkspace />
          ) : screen === "db" ? (
            <DbWorkspace />
          ) : screen === "calendar" ? (
            <CalendarWorkspace />
          ) : screen === "terminal" ? (
            <TerminalWorkspace />
          ) : (
            <Home last={last} onOpen={onScreen} />
          )}
        </AppNavProvider>
      </TabProvider>
    </div>
  );
}
