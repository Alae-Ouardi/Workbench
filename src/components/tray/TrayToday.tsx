// Today tab of the menu-bar panel: the current call, meetings to log in one
// click, time logged today and this week, and a quick way to log time.

import { useMemo, useState } from "react";
import { join } from "../../calendar/api";
import { addDays, nextMeeting, timeLabel, untilLabel } from "../../calendar/logic";
import { useCalendarAccess, useCalendarEvents } from "../../calendar/useCalendar";
import { meetingsApi, openPopupInMainWindow } from "../../meetings/api";
import { appNames, billableHours, clock, elapsed, minutesBetween, parseHours } from "../../meetings/logic";
import { useMeetings } from "../../meetings/MeetingProvider";
import type { MeetingSettings, PendingMeeting } from "../../meetings/types";
import { useNow, useToday } from "../../meetings/useNow";
import { tpwLogTime } from "../../tp-workspace/api";
import { requestRefresh, useTpwQuery } from "../../tp-workspace/hooks/useTpwQuery";
import { startOfWeek, todayIso } from "../../tp-workspace/logic/dates";
import { formatHours } from "../../tp-workspace/logic/duration";
import { usePrefs } from "../../tp-workspace/prefs";
import type { TpTimeEntry, TpWorkItem } from "../../tp-workspace/types";

/** From this hour on, a short day gets a reminder. */
const NUDGE_FROM_HOUR = 16;

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center">
        <h2 className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">{title}</h2>
        {aside && <span className="ml-auto">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const SMALL_BTN =
  "rounded-md border border-white/[0.08] px-2 py-0.5 text-[11px] text-slate-300 hover:border-sky-500/40 hover:text-sky-200 disabled:opacity-40";

export function TrayToday() {
  return (
    <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 text-slate-300">
      <MeetingCard />
      <NextMeetingCard />
      <PendingCard />
      <TimeCard />
      <QuickLog />
    </div>
  );
}

function MeetingCard() {
  const { live, settings, split, stop } = useMeetings();
  const now = useNow(live.active);
  if (!live.active || !live.started_at) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] px-3 py-2 text-[11.5px] text-slate-500">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
        {settings && !settings.enabled ? "Meeting detection is off" : live.suppressed ? "Not tracking this call" : "No call right now"}
      </div>
    );
  }
  const act = (fn: () => Promise<void>) => () => void fn().catch((e) => console.error("meeting action failed", e));
  return (
    <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2">
      <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400 shadow-[0_0_8px_#fb7185]" />
      <div className="min-w-0">
        <div className="num text-[15px] font-semibold text-rose-100">{elapsed(live.started_at, now)}</div>
        <div className="truncate text-[10.5px] text-rose-200/70">
          since {clock(live.started_at)}
          {live.apps.length > 0 && ` · ${appNames(live.apps)}`}
        </div>
      </div>
      <div className="ml-auto flex gap-1">
        <button className={SMALL_BTN} onClick={act(split)} title="Log this part and keep tracking the rest">
          Split
        </button>
        <button className={SMALL_BTN} onClick={act(stop)} title="Log what was tracked and stop tracking this call">
          Stop
        </button>
      </div>
    </div>
  );
}

function NextMeetingCard() {
  const { access } = useCalendarAccess();
  const today = useToday();
  const { events } = useCalendarEvents(today, addDays(today, 1), access === "granted");
  const now = useNow(true, 30_000);
  const next = nextMeeting(events, now);
  if (access !== "granted" || !next) return null;
  const live = Date.parse(next.start) <= now;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: next.calendar.color }} />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] tracking-wide text-slate-500 uppercase">{live ? "Now" : "Next meeting"}</div>
        <div className="truncate text-[12.5px] font-medium text-slate-100">{next.title}</div>
        <div className="num text-[10.5px] text-slate-400">
          {timeLabel(next.start)}–{timeLabel(next.end)} · {untilLabel(next, now)}
        </div>
      </div>
      {next.join_url && (
        <button className="shrink-0 rounded-md bg-sky-500/80 px-2.5 py-1 text-[11px] font-medium text-slate-950 hover:bg-sky-400" onClick={() => join(next)}>
          Join
        </button>
      )}
    </div>
  );
}

function PendingCard() {
  const { pending, settings } = useMeetings();
  if (!pending.length || !settings) return null;
  return (
    <Card title="Meetings to log" aside={<span className="num text-[11px] text-sky-300">{pending.length}</span>}>
      <ul className="space-y-2">
        {[...pending].reverse().map((m) => (
          <PendingRow key={m.id} meeting={m} settings={settings} />
        ))}
      </ul>
    </Card>
  );
}

function PendingRow({ meeting, settings }: { meeting: PendingMeeting; settings: MeetingSettings }) {
  const minutes = minutesBetween(meeting.start, meeting.end);
  const [hoursText, setHoursText] = useState(() =>
    String(Math.round(billableHours(minutes, settings.min_minutes, settings.step_minutes) * 100) / 100),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hours = parseHours(hoursText);

  async function log(taskId: number, description: string) {
    if (hours === null) return;
    setBusy(true);
    setError(null);
    try {
      await meetingsApi.log(meeting.id, taskId, hours, description);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-white/[0.05] p-2">
      <div className="mb-1.5 flex items-center gap-2 text-[11.5px]">
        <span className="num shrink-0 text-slate-200">
          {clock(meeting.start)}–{clock(meeting.end)}
        </span>
        {meeting.title && <span className="truncate text-slate-300">{meeting.title}</span>}
        <span className="truncate text-slate-500">
          {Math.round(minutes)} min{meeting.apps.length > 0 && ` · ${appNames(meeting.apps)}`}
        </span>
        <input
          className="num ml-auto w-14 rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-right text-[11.5px] text-slate-100 outline-none focus:border-sky-500/40"
          value={hoursText}
          onChange={(e) => setHoursText(e.target.value)}
          aria-label="Hours to log"
          aria-invalid={hours === null}
        />
        <span className="text-[10.5px] text-slate-500">h</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {settings.daily_task_id > 0 && (
          <button className={SMALL_BTN} disabled={busy || hours === null} onClick={() => void log(settings.daily_task_id, meeting.title ?? "Daily")}>
            Daily
          </button>
        )}
        {settings.shortcuts.map((s) => (
          <button
            key={s.id}
            className={SMALL_BTN}
            disabled={busy || hours === null}
            onClick={() => void log(s.task_id, s.description.trim() || meeting.title || s.name)}
            title={`Log to #${s.task_id}`}
          >
            {s.name}
          </button>
        ))}
        <button className={SMALL_BTN} disabled={busy} onClick={() => void openPopupInMainWindow(meeting.id)} title="Choose any task in the main window">
          Other…
        </button>
        <button
          className={`${SMALL_BTN} ml-auto`}
          disabled={busy}
          onClick={() => meetingsApi.dismiss(meeting.id).catch((e) => setError(String(e)))}
          title="Don't log this meeting"
        >
          Ignore
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[10.5px] text-rose-300">
          {error}
        </p>
      )}
    </li>
  );
}

function Bar({ value, target, color }: { value: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

function TimeCard() {
  const { prefs } = usePrefs();
  const today = todayIso();
  const q = useTpwQuery<TpTimeEntry[]>({ kind: "times", from: startOfWeek(today), to: today });
  const entries = q.data ?? [];
  const todayHours = entries.filter((t) => t.date === today).reduce((s, t) => s + t.spent, 0);
  const weekHours = entries.reduce((s, t) => s + t.spent, 0);
  const missing = prefs.daily_target_hours - todayHours;
  const nudge = new Date().getHours() >= NUDGE_FROM_HOUR && missing > 0.01;

  return (
    <Card title="Logged time" aside={q.refreshing ? <span className="text-[10px] text-slate-600">updating…</span> : undefined}>
      {q.error && !q.data ? (
        <p className="text-[11px] text-slate-500">Connect TargetProcess in the app to see your time.</p>
      ) : (
        <div className="space-y-2.5">
          {(
            [
              ["Today", todayHours, prefs.daily_target_hours, "#22d3ee"],
              ["This week", weekHours, prefs.weekly_target_hours, "#a78bfa"],
            ] as const
          ).map(([label, value, target, color]) => (
            <div key={label}>
              <div className="mb-1 flex items-baseline text-[11.5px]">
                <span className="text-slate-400">{label}</span>
                <span className="num ml-auto text-slate-100">{formatHours(value)}</span>
                <span className="num ml-1 text-[10.5px] text-slate-500">/ {formatHours(target)}</span>
              </div>
              <Bar value={value} target={target} color={color} />
            </div>
          ))}
          {nudge && <p className="text-[11px] text-amber-300">{formatHours(missing)} left to log today.</p>}
        </div>
      )}
    </Card>
  );
}

function QuickLog() {
  const work = useTpwQuery<TpWorkItem[]>({ kind: "my_work" });
  const [query, setQuery] = useState("");
  const [item, setItem] = useState<TpWorkItem | null>(null);
  const [hoursText, setHoursText] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const open = useMemo(() => (work.data ?? []).filter((i) => !i.state.is_final), [work.data]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    if (!q) return [];
    return open.filter((i) => String(i.id).includes(q) || i.name.toLowerCase().includes(q)).slice(0, 6);
  }, [open, query]);
  const hours = parseHours(hoursText);
  const canLog = !busy && !!item && hours !== null && description.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canLog || !item || hours === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await tpwLogTime(item.id, hours, description.trim(), todayIso());
      setMessage({ ok: true, text: `Logged ${formatHours(hours)} to #${item.id}` });
      setHoursText("");
      setDescription("");
      requestRefresh();
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }

  const field =
    "min-w-0 flex-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11.5px] text-slate-200 outline-none placeholder:text-slate-600 focus:border-sky-500/40";

  return (
    <Card title="Quick log">
      <form className="space-y-1.5" onSubmit={(e) => void submit(e)}>
        {item ? (
          <div className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11.5px]">
            <span className="num text-sky-300">#{item.id}</span>
            <span className="truncate text-slate-200">{item.name}</span>
            <button type="button" className="ml-auto text-slate-500 hover:text-slate-200" onClick={() => setItem(null)} aria-label="Change item">
              ×
            </button>
          </div>
        ) : (
          <div>
            <input className={`${field} w-full`} placeholder="Search your items…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <ul className="mt-1 max-h-36 overflow-y-auto rounded-md border border-white/[0.06]">
                {matches.map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className="flex w-full gap-2 px-2 py-1 text-left text-[11.5px] hover:bg-white/[0.05]"
                      onClick={() => {
                        setItem(i);
                        setQuery("");
                      }}
                    >
                      <span className="num shrink-0 text-slate-500">#{i.id}</span>
                      <span className="truncate text-slate-300">{i.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex gap-1.5">
          <input className={`${field} num w-16 flex-none text-right`} placeholder="h" inputMode="decimal" value={hoursText} onChange={(e) => setHoursText(e.target.value)} aria-label="Hours" />
          <input className={field} placeholder="What did you do?" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
        </div>
        <div className="flex items-center gap-2">
          {message && <span className={`truncate text-[10.5px] ${message.ok ? "text-emerald-300" : "text-rose-300"}`}>{message.text}</span>}
          <button type="submit" className="ml-auto rounded-md bg-sky-500/80 px-3 py-1 text-[11.5px] font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-40" disabled={!canLog}>
            {busy ? "Logging…" : "Log today"}
          </button>
        </div>
      </form>
    </Card>
  );
}
