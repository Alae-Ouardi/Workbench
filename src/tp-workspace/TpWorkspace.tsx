import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTabActive, useTabState } from "../shell/TabContext";
import { AppSwitcher } from "../shell/AppSwitcher";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette";
import { FilterBar } from "./components/FilterBar";
import {
  IconAlarm,
  IconCalendar,
  IconClock,
  IconDashboard,
  IconHome,
  IconMic,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconStories,
  IconUser,
} from "./components/icons";
import { ItemDrawer } from "./components/ItemDrawer";
import { requestRefresh } from "./hooks/useTpwQuery";
import { usePrefs } from "./prefs";
import { DashboardView } from "./views/DashboardView";
import { MyWorkView } from "./views/MyWorkView";
import { OverdueView } from "./views/OverdueView";
import { WorkspaceSettingsView } from "./views/SettingsView";
import { SprintStoriesView } from "./views/SprintStoriesView";
import { StandupView } from "./views/StandupView";
import { TimeView } from "./views/TimeView";
import { useWorkspace, WorkspaceProvider } from "./WorkspaceContext";
import { useMeetings } from "../meetings/MeetingProvider";
import { MeetingsView } from "../meetings/MeetingsView";

export type WorkspaceView = "dashboard" | "sprint" | "overdue" | "time" | "mywork" | "standup" | "meetings" | "settings";

const NAV: Array<{ id: WorkspaceView; label: string; icon: (p: { size?: number }) => ReactNode; key: string }> = [
  { id: "dashboard", label: "Dashboard", icon: IconDashboard, key: "1" },
  { id: "sprint", label: "Sprint stories", icon: IconStories, key: "2" },
  { id: "mywork", label: "My work", icon: IconUser, key: "3" },
  { id: "overdue", label: "Overdue", icon: IconAlarm, key: "4" },
  { id: "time", label: "Time", icon: IconCalendar, key: "5" },
  { id: "standup", label: "Standup", icon: IconMic, key: "6" },
  { id: "meetings", label: "Meetings", icon: IconClock, key: "7" },
  { id: "settings", label: "Settings", icon: IconSettings, key: "," },
];

export function TpWorkspace({ onHome }: { onHome: () => void }) {
  // Remounting the provider after the connection changes reloads everything
  // for the new account in one go.
  const [generation, setGeneration] = useState(0);
  return (
    <WorkspaceProvider key={generation}>
      <Shell onHome={onHome} onConnectionChanged={() => setGeneration((g) => g + 1)} />
    </WorkspaceProvider>
  );
}

function Shell({ onHome, onConnectionChanged }: { onHome: () => void; onConnectionChanged: () => void }) {
  const { connection, me, myWork } = useWorkspace();
  const { prefs } = usePrefs();
  const [view, setView] = useTabState<WorkspaceView>("tpw.view", "dashboard");
  const [palette, setPalette] = useState(false);
  const active: WorkspaceView = connection === "not_configured" ? "settings" : view;

  // Background refresh on the configured interval.
  useEffect(() => {
    if (connection !== "ready") return;
    const id = window.setInterval(requestRefresh, Math.max(1, prefs.refresh_minutes) * 60_000);
    return () => window.clearInterval(id);
  }, [connection, prefs.refresh_minutes]);

  // ⌘1–9 switch tabs (handled in Root), so views live on ⌃⌘1–7.
  const tabActive = useTabActive();
  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey) return;
      if (e.ctrlKey) {
        const target = NAV.find((n) => n.key === e.key);
        if (target) {
          e.preventDefault();
          setView(target.id);
        }
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (e.key === "r") {
        e.preventDefault();
        requestRefresh();
      } else if (e.key === ",") {
        e.preventDefault();
        setView("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabActive, setView]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...NAV.map((n) => ({
        id: `nav-${n.id}`,
        label: `Go to ${n.label}`,
        hint: n.key === "," ? "⌘," : `⌃⌘${n.key}`,
        icon: n.icon({ size: 14 }),
        run: () => setView(n.id),
      })),
      { id: "refresh", label: "Refresh from TargetProcess", hint: "⌘R", icon: <IconRefresh size={14} />, run: requestRefresh },
      { id: "home", label: "Back to home", icon: <IconHome size={14} />, run: onHome },
    ],
    [setView, onHome],
  );

  const openCount = myWork.filter((i) => !i.state.is_final).length;
  const toLog = useMeetings().pending.length;

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="glass flex w-56 shrink-0 flex-col border-y-0 border-l-0 px-3 py-4">
        <div className="mb-6">
          <AppSwitcher title="TP Workspace" subtitle="TargetProcess" />
        </div>
        <div className="space-y-0.5">
          {NAV.filter((n) => n.id !== "settings").map((n) => (
            <NavButton key={n.id} active={active === n.id} onClick={() => setView(n.id)} icon={n.icon({ size: 16 })} label={n.label}>
              {n.id === "mywork" && openCount > 0 && <span className="num chip ml-auto py-0">{openCount}</span>}
              {n.id === "meetings" && toLog > 0 && <span className="num chip ml-auto border-sky-500/40 py-0 text-sky-300">{toLog}</span>}
            </NavButton>
          ))}
        </div>
        <div className="mt-auto space-y-0.5">
          <NavButton active={active === "settings"} onClick={() => setView("settings")} icon={<IconSettings size={16} />} label="Settings" />
          {me && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--line-soft)] px-2.5 py-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              <span className="truncate text-[11px] text-slate-400">{me.name}</span>
            </div>
          )}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] px-5 py-3">
          {active !== "settings" && active !== "meetings" && <FilterBar showSprint={active === "dashboard" || active === "sprint"} />}
          <div className="ml-auto flex items-center gap-2">
            <button className="btn" onClick={() => setPalette(true)}>
              <IconSearch size={14} /> Search <kbd className="num text-[10px] text-slate-500">⌘K</kbd>
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {connection === "checking" ? null : active === "dashboard" ? (
            <DashboardView />
          ) : active === "sprint" ? (
            <SprintStoriesView />
          ) : active === "overdue" ? (
            <OverdueView />
          ) : active === "time" ? (
            <TimeView />
          ) : active === "mywork" ? (
            <MyWorkView />
          ) : active === "standup" ? (
            <StandupView />
          ) : active === "meetings" ? (
            <MeetingsView />
          ) : (
            <>
              {connection === "not_configured" && (
                <div className="mb-4 max-w-3xl rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-xs text-sky-300">
                  Connect your TargetProcess account to light up the workspace.
                </div>
              )}
              <WorkspaceSettingsView onConnectionChanged={onConnectionChanged} />
            </>
          )}
        </main>
      </div>

      <ItemDrawer />
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    </div>
  );
}

function NavButton({
  active,
  onClick,
  icon,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
        active ? "bg-[var(--line)] text-slate-50" : "text-slate-400 hover:bg-[var(--line-soft)] hover:text-slate-200"
      }`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--acc-400)] shadow-[0_0_10px_var(--acc-400)]" />}
      <span className={active ? "text-sky-300" : ""}>{icon}</span>
      {label}
      {children}
    </button>
  );
}
