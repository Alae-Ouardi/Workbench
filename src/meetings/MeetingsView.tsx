// Meetings page in TP Workspace: the live call, meetings waiting to be
// logged, and recently logged time; settings on their own tab.

import { TpId } from "../tp-workspace/components/ui";
import { formatDay, todayIso } from "../tp-workspace/logic/dates";
import { formatHours } from "../tp-workspace/logic/duration";
import { useLocalState } from "../tp-workspace/prefs";
import { meetingsApi } from "./api";
import { appNames, clock, elapsed, minutesBetween } from "./logic";
import { useMeetings } from "./MeetingProvider";
import { MeetingSettingsView } from "./MeetingSettingsView";
import { useNow } from "./useNow";
import type { LoggedMeeting } from "./types";

type Tab = "meetings" | "settings";

export function MeetingsView() {
  const [tab, setTab] = useLocalState<Tab>("meetings.tab", "meetings");
  const { settings } = useMeetings();
  const unset = settings && settings.daily_task_id <= 0 && settings.shortcuts.length === 0;

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-end gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Meetings</h1>
          <p className="text-xs text-slate-500">
            Calls are detected from microphone use. When one ends you're asked where to log the time.
          </p>
        </div>
        <div className="ml-auto inline-flex rounded-lg border border-[var(--line)] p-0.5 text-[11.5px]">
          {(["meetings", "settings"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 ${tab === t ? "bg-[rgb(34_211_238/0.12)] text-sky-200" : "text-slate-400 hover:text-slate-200"}`}
            >
              {t === "meetings" ? "Meetings" : "Settings"}
            </button>
          ))}
        </div>
      </div>

      {tab === "settings" ? (
        <MeetingSettingsView />
      ) : (
        <>
          {unset && (
            <button
              className="mb-4 w-full rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-left text-xs text-sky-300 hover:bg-sky-500/15"
              onClick={() => setTab("settings")}
            >
              Set your daily task and meeting shortcuts so a meeting can be logged in one click →
            </button>
          )}
          <LiveCard />
          <PendingList />
          <LoggedList />
        </>
      )}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="glass mb-3 rounded-2xl p-4">
      <div className="mb-2 flex items-center">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {aside && <span className="num ml-auto text-[11px] text-slate-500">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function LiveCard() {
  const { live, settings, split, stop } = useMeetings();
  const now = useNow(live.active);

  const status = !settings?.enabled
    ? "Detection is off — turn it on in Settings."
    : live.suppressed
      ? "Not tracking the current call (stopped). The next call will be detected."
      : "Waiting for a call. A meeting starts when an app uses the microphone.";

  return (
    <Section title={live.active ? "In a meeting" : "Now"}>
      {live.active && live.started_at ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-400 shadow-[0_0_10px_#fb7185]" />
          <span className="num text-2xl font-semibold text-slate-100">{elapsed(live.started_at, now)}</span>
          <span className="text-xs text-slate-500">
            since {clock(live.started_at)}
            {live.apps.length > 0 && ` · ${appNames(live.apps)}`}
          </span>
          <div className="ml-auto flex gap-2">
            <button className="btn" onClick={() => split().catch((e) => console.error("split failed", e))} title="Log this part now and keep tracking the rest">
              Split
            </button>
            <button className="btn" onClick={() => stop().catch((e) => console.error("stop failed", e))} title="Log what was tracked and stop tracking this call">
              Stop tracking
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">{status}</p>
      )}
    </Section>
  );
}

function PendingList() {
  const { pending, openPopup } = useMeetings();
  return (
    <Section title="To log" aside={pending.length ? String(pending.length) : undefined}>
      {pending.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing waiting.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {[...pending].reverse().map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2 text-[13px]">
              <span className="num text-slate-200">
                {localDay(m.start) === todayIso() ? "" : `${formatDay(localDay(m.start))} · `}
                {clock(m.start)}–{clock(m.end)}
              </span>
              <span className="text-[11px] text-slate-500">
                {Math.round(minutesBetween(m.start, m.end))} min{m.apps.length > 0 && ` · ${appNames(m.apps)}`}
              </span>
              <div className="ml-auto flex gap-2">
                <button className="btn btn-primary" onClick={() => openPopup(m.id)}>
                  Log…
                </button>
                <button className="btn" onClick={() => meetingsApi.dismiss(m.id).catch((e) => console.error("dismiss failed", e))} title="Forget this meeting">
                  Ignore
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function LoggedList() {
  const { logged } = useMeetings();
  const byDay = new Map<string, LoggedMeeting[]>();
  for (const m of [...logged].sort((a, b) => b.start.localeCompare(a.start))) {
    const day = localDay(m.start);
    byDay.set(day, [...(byDay.get(day) ?? []), m]);
  }
  const today = todayIso();

  return (
    <Section title="Logged recently" aside="last 14 days">
      {byDay.size === 0 ? (
        <p className="text-xs text-slate-500">Nothing logged from here yet.</p>
      ) : (
        <div className="space-y-3">
          {[...byDay.entries()].map(([day, items]) => (
            <div key={day}>
              <div className="mb-1 flex items-center text-[11px] text-slate-500">
                <span>{day === today ? "Today" : formatDay(day)}</span>
                <span className="num ml-auto">{formatHours(items.reduce((s, m) => s + m.hours, 0))}</span>
              </div>
              <ul className="space-y-1">
                {items.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-2 text-[13px]">
                    <TpId id={m.task_id} className="text-[11px] text-slate-500" />
                    <span className="text-slate-200">{m.description || (m.kind === "recurring" ? "Recurring" : "Meeting")}</span>
                    <span className="text-[11px] text-slate-500">
                      {m.kind === "recurring" ? "auto-logged" : `${clock(m.start)}–${clock(m.end)}`}
                    </span>
                    <span className="num ml-auto text-[12px] text-slate-300">{formatHours(m.hours)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
