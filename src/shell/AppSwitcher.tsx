// App switcher: a menu button beside the logo, shared by every workspace. It
// changes what the current tab shows; ⌘-click (or "New tab") opens another tab.

import { useOverlay } from "../shared/overlay";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconBoard, IconBolt, IconCalendar, IconCube, IconDatabase, IconHome, IconMenu, IconTerminal } from "../shared/icons";
import { LogoMark } from "./Logo";
import { APP_MODES, useHiddenViews } from "./views";

export type AppMode = "taskboard" | "tp" | "k8s" | "db" | "calendar" | "terminal";
export type Screen = "home" | AppMode;

interface AppNav {
  current: Screen;
  /** Show `screen` in this tab. */
  go: (screen: Screen) => void;
  /** Open `screen` in a new tab. */
  openNew: (screen: Screen) => void;
}

const AppNavContext = createContext<AppNav | null>(null);

export const AppNavProvider = ({ value, children }: { value: AppNav; children: ReactNode }) => (
  <AppNavContext.Provider value={value}>{children}</AppNavContext.Provider>
);

export const SCREEN_META: Record<Screen, { label: string; color: string; icon: (size: number) => ReactNode }> = {
  home: { label: "Home", color: "#94a3b8", icon: (s) => <IconHome size={s} /> },
  taskboard: { label: "TaskBoard", color: "#22d3ee", icon: (s) => <IconBoard size={s} /> },
  tp: { label: "TP Workspace", color: "#a78bfa", icon: (s) => <IconBolt size={s} /> },
  k8s: { label: "Kubernetes", color: "#34d399", icon: (s) => <IconCube size={s} /> },
  db: { label: "Database", color: "#fbbf24", icon: (s) => <IconDatabase size={s} /> },
  calendar: { label: "Calendar", color: "#fb7185", icon: (s) => <IconCalendar size={s} /> },
  terminal: { label: "Terminal", color: "#e2e8f0", icon: (s) => <IconTerminal size={s} /> },
};

export function AppSwitcher({ title, subtitle }: { title: string; subtitle: string }) {
  const nav = useContext(AppNavContext);
  const [open, setOpen] = useState(false);
  useOverlay(open);
  const root = useRef<HTMLDivElement>(null);
  const hidden = useHiddenViews();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1 text-left hover:bg-[var(--line-soft)] ${open ? "bg-[var(--line-soft)]" : ""}`}
        title="Switch app"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <LogoMark size={30} />
        <div className="min-w-0 flex-1 leading-none">
          <div className="truncate text-[13px] font-semibold tracking-tight text-slate-100">{title}</div>
          <div className="num mt-1 truncate text-[10px] uppercase tracking-[0.18em] text-sky-400">{subtitle}</div>
        </div>
        <span className="rounded-lg border border-[var(--line-soft)] p-1 text-slate-400">
          <IconMenu size={14} />
        </span>
      </button>
      {open && nav && (
        <div role="menu" className="animate-rise absolute top-full right-0 left-0 z-50 mt-2 rounded-xl border border-[var(--line-strong)] bg-[var(--panel-solid)] p-1.5 shadow-2xl">
          {(["home", ...APP_MODES] as Screen[]).filter((id) => !hidden.includes(id as AppMode)).map((id) => {
            const meta = SCREEN_META[id];
            const active = id === nav.current;
            return (
              <button
                key={id}
                role="menuitem"
                onClick={(e) => {
                  setOpen(false);
                  if (e.metaKey) nav.openNew(id);
                  else if (!active) nav.go(id);
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                  active ? "bg-[rgb(34_211_238/0.12)] text-sky-300" : "text-slate-300 hover:bg-[var(--line-soft)]"
                }`}
              >
                <span style={{ color: active ? undefined : meta.color }}>{meta.icon(15)}</span>
                <span className="flex-1">{meta.label}</span>
              </button>
            );
          })}
          <div className="my-1 h-px bg-[var(--line)]" />
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              nav.openNew("home");
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-300 hover:bg-[var(--line-soft)]"
          >
            <span className="w-[15px] text-center text-base leading-none">+</span>
            <span className="flex-1">New tab</span>
            <span className="num text-[10px] text-slate-500">⌘T</span>
          </button>
          <p className="px-2.5 pt-1 pb-0.5 text-[10px] text-slate-600">⌘-click opens in a new tab</p>
        </div>
      )}
    </div>
  );
}
