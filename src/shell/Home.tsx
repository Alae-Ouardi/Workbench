import { invoke } from "@tauri-apps/api/core";
import { useTabActive } from "./TabContext";
import { useEffect, useState, type ReactNode } from "react";
import packageJson from "../../package.json";
import { listProjects, tpGetSettings } from "../api";
import { tpwQuery } from "../tp-workspace/api";
import { IconBoard, IconBolt, IconCalendar, IconCube, IconDatabase, IconTerminal } from "../shared/icons";
import { useFolders } from "../terminal/store";
import { calendarApi } from "../calendar/api";
import { addDays, nextMeeting, startOfDay, timeLabel, untilLabel } from "../calendar/logic";
import type { CalEvent } from "../calendar/types";
import { formatDay, todayIso } from "../tp-workspace/logic/dates";
import { formatHours, roundHours } from "../tp-workspace/logic/duration";
import { sum } from "../tp-workspace/logic/work";
import { usePrefs } from "../tp-workspace/prefs";
import type { TpTimeEntry, TpWorkItem } from "../tp-workspace/types";
import { GlobalSettings } from "./GlobalSettings";
import { LogoMark } from "./Logo";
import { useHiddenViews, visibleModes } from "./views";

import type { AppMode } from "./AppSwitcher";
export type { AppMode };

interface BoardStats {
  active: number;
  inProgress: number;
  review: number;
  projects: number;
}

interface TpStats {
  connected: boolean;
  open: number;
  hoursToday: number | null;
  userName: string;
}

const MODE_NAMES: Record<AppMode, string> = {
  taskboard: "TaskBoard",
  tp: "TP Workspace",
  k8s: "Kubernetes",
  db: "Database",
  calendar: "Calendar",
  terminal: "Terminal",
};

/** A string list kept in localStorage by a workspace (recents, favourites). */
function readList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function countConnections(): Promise<number | null> {
  try {
    const tree = await invoke<{ connections: unknown[] }>("db_connections_get");
    return tree.connections.length;
  } catch {
    return null;
  }
}

function greeting(hour: number): string {
  if (hour < 5) return "Burning the midnight oil";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function Home({ last, onOpen }: { last: AppMode; onOpen: (mode: AppMode) => void }) {
  const { prefs } = usePrefs();
  const [board, setBoard] = useState<BoardStats | null>(null);
  const [tp, setTp] = useState<TpStats | null>(null);
  const [dbCount, setDbCount] = useState<number | null>(null);
  const k8sRecents = readList("k8s.recentEnvs");
  const k8sFavourites = readList("k8s.favouriteEnvs");
  const today = todayIso();
  const visible = visibleModes(useHiddenViews());
  // Enter reopens the last view, or the first one shown if that was hidden.
  const enterMode = visible.includes(last) ? last : visible[0];
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    listProjects()
      .then((ps) =>
        setBoard({
          active: sum(ps.map((p) => p.open + p.waiting + p.in_progress + p.review)),
          inProgress: sum(ps.map((p) => p.in_progress)),
          review: sum(ps.map((p) => p.review)),
          projects: ps.length,
        }),
      )
      .catch(() => setBoard(null));

    // Cached snapshots only: the home screen must open instantly, even offline.
    tpGetSettings()
      .then(async (s) => {
        const connected = s.token_set && s.base_url_normalized.length > 8;
        if (!connected) return setTp({ connected, open: 0, hoursToday: null, userName: "" });
        const [work, times] = await Promise.all([
          tpwQuery<TpWorkItem[]>({ kind: "my_work" }, false).catch(() => null),
          tpwQuery<TpTimeEntry[]>({ kind: "times", from: today, to: today }, false).catch(() => null),
        ]);
        setTp({
          connected,
          open: work?.payload.filter((i) => !i.state.is_final).length ?? 0,
          hoursToday: times ? roundHours(sum(times.payload.map((t) => t.spent))) : null,
          userName: s.cached_user_name,
        });
      })
      .catch(() => setTp(null));

    countConnections().then(setDbCount);
  }, [today]);

  const tabActive = useTabActive();
  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (typing || settingsOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const pick = e.key === "Enter" ? enterMode : /^[1-9]$/.test(e.key) ? visible[Number(e.key) - 1] : undefined;
      if (!pick) return;
      // Consume the key so it doesn't land in the opened view's search box.
      e.preventDefault();
      onOpen(pick);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabActive, enterMode, visible, settingsOpen, onOpen]);

  // Today's meetings, when calendar access was already given (no prompt here).
  const [meetingsToday, setMeetingsToday] = useState<CalEvent[] | null>(null);
  useEffect(() => {
    calendarApi
      .access()
      .then((a) => {
        if (a !== "granted") return;
        const day = startOfDay(new Date());
        return calendarApi.events(day, addDays(day, 1)).then(setMeetingsToday);
      })
      .catch(() => {});
  }, []);
  const nextUp = meetingsToday ? nextMeeting(meetingsToday, Date.now()) : undefined;

  const termFolders = useFolders();
  const firstName = tp?.userName.split(" ")[0];

  const cards: Record<AppMode, ReactNode> = {
    taskboard: (
      <LaunchCard
        key="taskboard"
            title="TaskBoard"
            tagline="Plans, agents and handoffs"
            icon={<IconBoard size={22} />}
            accent="#22d3ee"
            stats={
              board
                ? [
                    { label: "active tasks", value: board.active },
                    { label: "in progress", value: board.inProgress },
                    { label: "in review", value: board.review },
                  ]
                : null
            }
        shortcut={String(visible.indexOf("taskboard") + 1)}
        highlighted={last === "taskboard"}
        onClick={() => onOpen("taskboard")}
      />
    ),
    tp: (
      <LaunchCard
        key="tp"
            title="TP Workspace"
            tagline="Sprint, time and standup from TargetProcess"
            icon={<IconBolt size={22} />}
            accent="#a78bfa"
            stats={
              tp === null
                ? null
                : tp.connected
                  ? [
                      { label: "open items", value: tp.open },
                      {
                        label: `of ${formatHours(prefs.daily_target_hours)} today`,
                        value: tp.hoursToday === null ? "—" : formatHours(tp.hoursToday),
                      },
                    ]
                  : [{ label: "connect your account to start", value: "→" }]
            }
        shortcut={String(visible.indexOf("tp") + 1)}
        highlighted={last === "tp"}
        onClick={() => onOpen("tp")}
      />
    ),
    k8s: (
      <LaunchCard
        key="k8s"
            title="Kubernetes"
            tagline="Pods, logs, shells and YAML across every cluster"
            icon={<IconCube size={22} />}
            accent="#34d399"
            stats={[
              { label: "favourite envs", value: k8sFavourites.length },
              { label: "last environment", value: k8sRecents[0] ? <span className="text-base">{k8sRecents[0].split("/").pop()}</span> : "—" },
            ]}
        shortcut={String(visible.indexOf("k8s") + 1)}
        highlighted={last === "k8s"}
        onClick={() => onOpen("k8s")}
      />
    ),
    db: (
      <LaunchCard
        key="db"
            title="Database"
            tagline="Tunnel in, browse tables, edit data"
            icon={<IconDatabase size={22} />}
            accent="#fbbf24"
            stats={dbCount === null ? [{ label: "add your first connection", value: "→" }] : [{ label: "saved connections", value: dbCount }]}
        shortcut={String(visible.indexOf("db") + 1)}
        highlighted={last === "db"}
        onClick={() => onOpen("db")}
      />
    ),
    calendar: (
      <LaunchCard
        key="calendar"
            title="Calendar"
            tagline="Today's meetings, join links and reminders"
            icon={<IconCalendar size={22} />}
            accent="#fb7185"
            stats={
              meetingsToday === null
                ? [{ label: "connect your calendars", value: "→" }]
                : [
                    { label: "meetings today", value: meetingsToday.filter((e) => !e.all_day).length },
                    {
                      label: nextUp ? `next · ${untilLabel(nextUp, Date.now())}` : "nothing else today",
                      value: nextUp ? <span className="text-base">{timeLabel(nextUp.start)}</span> : "—",
                    },
                  ]
            }
        shortcut={String(visible.indexOf("calendar") + 1)}
        highlighted={last === "calendar"}
        onClick={() => onOpen("calendar")}
      />
    ),
    terminal: (
      <LaunchCard
        key="terminal"
            title="Terminal"
            tagline="Split terminals, organised by folder"
            icon={<IconTerminal size={22} />}
            accent="#e2e8f0"
            stats={
              termFolders.length
                ? [
                    { label: "folders", value: termFolders.length },
                    { label: "last folder", value: <span className="text-base">{termFolders[termFolders.length - 1].name}</span> },
                  ]
                : [{ label: "open your first folder", value: "→" }]
            }
        shortcut={String(visible.indexOf("terminal") + 1)}
        highlighted={last === "terminal"}
        onClick={() => onOpen("terminal")}
      />
    ),
  };

  return (
    <div className="relative flex h-full flex-col items-center overflow-y-auto px-8 py-8">
      <button
        onClick={() => setSettingsOpen(true)}
        className="absolute top-5 right-6 flex items-center gap-1.5 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[12px] text-slate-400 hover:border-[var(--line-strong)] hover:text-slate-100"
        title="Settings"
      >
        <span className="text-sm leading-none">⚙</span> Settings
      </button>
      {settingsOpen && <GlobalSettings onClose={() => setSettingsOpen(false)} />}
      <div className="animate-rise mt-auto mb-10 flex flex-col items-center text-center">
        <LogoMark size={64} />
        <div className="num mt-3 text-[10.5px] font-semibold tracking-[0.35em] text-sky-300/80 uppercase">Workbench</div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-50">
          {greeting(new Date().getHours())}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {formatDay(today)} · where do you want to work?
        </p>
      </div>

      <div className="grid w-full max-w-5xl grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((mode) => cards[mode])}
      </div>

      <div className="mt-10 mb-auto flex items-center gap-4 text-[11px] text-slate-600">
        <span>
          <kbd className="chip num">↵</kbd> open {MODE_NAMES[enterMode]}
        </span>
        <span>
          <kbd className="chip num">1</kbd>
          {visible.length > 1 && (
            <>
              –<kbd className="chip num">{visible.length}</kbd>
            </>
          )}{" "}
          pick · <kbd className="chip num">⌘T</kbd> new tab · <kbd className="chip num">⌘W</kbd> close
        </span>
        <span className="num">v{packageJson.version}</span>
      </div>
    </div>
  );
}

function LaunchCard({
  title,
  tagline,
  icon,
  accent,
  shortcut,
  highlighted,
  onClick,
  stats,
}: {
  title: string;
  tagline: string;
  icon: ReactNode;
  accent: string;
  shortcut: string;
  highlighted: boolean;
  onClick: () => void;
  stats: Array<{ label: string; value: ReactNode }> | null;
}) {
  return (
    <button
      onClick={onClick}
      className="glass animate-rise group relative overflow-hidden rounded-3xl p-7 text-left transition-all duration-300 hover:-translate-y-1"
      style={{
        boxShadow: highlighted ? `0 0 0 1px ${accent}66, 0 20px 60px -20px ${accent}55` : undefined,
      }}
    >
      <div
        className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl transition-opacity duration-500 group-hover:opacity-60"
        style={{ background: accent }}
      />
      <div className="relative flex items-start justify-between">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-2xl"
          style={{ color: accent, background: `${accent}1a`, boxShadow: `inset 0 0 0 1px ${accent}40` }}
        >
          {icon}
        </span>
        <kbd className="chip num">{shortcut}</kbd>
      </div>
      <h2 className="relative mt-6 text-xl font-semibold text-slate-50">{title}</h2>
      <p className="relative mt-1 text-xs text-slate-500">{tagline}</p>
      <div className="relative mt-6 flex gap-6">
        {stats === null ? (
          <div className="skeleton h-10 w-40" />
        ) : (
          stats.map((s) => (
            <div key={s.label}>
              <div className="num text-2xl font-semibold" style={{ color: accent }}>
                {s.value}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">{s.label}</div>
            </div>
          ))
        )}
      </div>
      <div className="relative mt-6 flex items-center gap-1.5 text-xs font-medium text-slate-400 group-hover:text-slate-100">
        Open <span className="transition-transform group-hover:translate-x-1">→</span>
      </div>
    </button>
  );
}
