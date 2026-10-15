// Calendar workspace: the Mac's calendars (Outlook/Exchange included once
// the account is in System Settings) as a day or week timeline.

import { useEffect, useMemo, useState } from "react";
import { AppSwitcher } from "../shell/AppSwitcher";
import { useTabActive } from "../shell/TabContext";
import { IconCalendar, IconChevronLeft, IconChevronRight, IconRefresh } from "../shared/icons";
import { useLocalState } from "../shared/useLocalState";
import { join, openCalendarPrivacy } from "./api";
import { EventDetails } from "./EventDetails";
import { addDays, nextMeeting, startOfDay, startOfWeek, timeLabel, untilLabel } from "./logic";
import { TimeGrid } from "./TimeGrid";
import { useToday } from "../meetings/useNow";
import { useCalendarAccess, useCalendarEvents } from "./useCalendar";
import type { CalEvent, CalendarInfo } from "./types";

type Mode = "day" | "week";

const rangeTitle = (days: Date[]) => {
  const first = days[0];
  const last = days[days.length - 1];
  if (days.length === 1) return first.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const sameMonth = first.getMonth() === last.getMonth();
  const a = first.toLocaleDateString(undefined, { day: "numeric", month: sameMonth ? undefined : "short" });
  const b = last.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  return `${a} – ${b}`;
};

export function CalendarWorkspace() {
  const { access, prompt, request } = useCalendarAccess();
  const [mode, setMode] = useLocalState<Mode>("calendar.mode", "week");
  const [hiddenList, setHiddenList] = useLocalState<string[]>("calendar.hidden", []);
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<CalEvent | null>(null);
  const tabActive = useTabActive();

  const days = useMemo(() => {
    const first = mode === "day" ? anchor : startOfWeek(anchor);
    return Array.from({ length: mode === "day" ? 1 : 7 }, (_, i) => addDays(first, i));
  }, [mode, anchor]);
  const from = days[0];
  const to = addDays(days[days.length - 1], 1);
  const { events, loading, error, reload } = useCalendarEvents(from, to, access === "granted");
  const today = useToday();
  const todayQ = useCalendarEvents(today, addDays(today, 1), access === "granted");
  const hidden = useMemo(() => new Set(hiddenList), [hiddenList]);

  const calendars = useMemo(() => {
    const map = new Map<string, CalendarInfo>();
    [...events, ...todayQ.events].forEach((e) => map.set(e.calendar.id, e.calendar));
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [events, todayQ.events]);

  const step = (dir: number) => setAnchor((a) => addDays(a, dir * (mode === "day" ? 1 : 7)));

  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input:not([type="checkbox"]), textarea, select');
      if (typing) return;
      if (e.metaKey && e.key === "r") {
        e.preventDefault();
        void reload();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "t") setAnchor(startOfDay(new Date()));
      else if (e.key === "d") setMode("day");
      else if (e.key === "w") setMode("week");
      else if (e.key === "Escape") setSelected(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const next = nextMeeting(todayQ.events.filter((e) => !hidden.has(e.calendar.id)), Date.now());

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="glass flex w-56 shrink-0 flex-col border-y-0 border-l-0 px-3 py-4">
        <div className="mb-6">
          <AppSwitcher title="Calendar" subtitle="Your schedule" />
        </div>

        {next && (
          <div className="mb-5 rounded-xl border border-[var(--line)] p-3">
            <div className="label mb-1">Next</div>
            <button className="block w-full text-left" onClick={() => setSelected(next)}>
              <div className="truncate text-[13px] font-medium text-slate-100">{next.title}</div>
              <div className="num text-[11px] text-slate-400">
                {timeLabel(next.start)} · {untilLabel(next, Date.now())}
              </div>
            </button>
            {next.join_url && (
              <button className="btn btn-primary mt-2 w-full justify-center py-1 text-[11.5px]" onClick={() => join(next)}>
                Join
              </button>
            )}
          </div>
        )}

        {calendars.length > 0 && (
          <div>
            <div className="label mb-1.5 px-1">Calendars</div>
            <ul className="space-y-0.5">
              {calendars.map((c) => {
                const off = hidden.has(c.id);
                return (
                  <li key={c.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] hover:bg-[var(--line-soft)]">
                      <input
                        type="checkbox"
                        checked={!off}
                        onChange={() => setHiddenList(off ? hiddenList.filter((id) => id !== c.id) : [...hiddenList, c.id])}
                        className="sr-only"
                      />
                      <span
                        className="h-3 w-3 shrink-0 rounded-[4px] border"
                        style={{ background: off ? "transparent" : c.color, borderColor: c.color }}
                      />
                      <span className={`truncate ${off ? "text-slate-600" : "text-slate-300"}`}>{c.title}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <p className="mt-auto px-1 text-[10.5px] leading-relaxed text-slate-600">
          ← → move · T today · D / W day or week. Outlook meetings appear once your work account is added in System Settings › Internet Accounts.
        </p>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
          <button className="btn py-1" onClick={() => setAnchor(startOfDay(new Date()))}>
            Today
          </button>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-[var(--line)] hover:text-slate-100" onClick={() => step(-1)} aria-label="Previous">
            <IconChevronLeft size={15} />
          </button>
          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-[var(--line)] hover:text-slate-100" onClick={() => step(1)} aria-label="Next">
            <IconChevronRight size={15} />
          </button>
          <h1 className="ml-1 text-[15px] font-semibold text-slate-100">{rangeTitle(days)}</h1>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="rounded-lg p-1.5 text-slate-500 hover:bg-[var(--line)] hover:text-slate-100"
              onClick={() => void reload()}
              title="Refresh (⌘R)"
              aria-label="Refresh"
            >
              <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <div className="inline-flex rounded-lg border border-[var(--line)] p-0.5 text-[11.5px]">
              {(["day", "week"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={`rounded-md px-3 py-1 ${mode === m ? "bg-[rgb(34_211_238/0.12)] text-sky-200" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {m === "day" ? "Day" : "Week"}
                </button>
              ))}
            </div>
          </div>
        </header>

        {access === null ? null : access !== "granted" ? (
          <AccessPrompt access={access} prompt={prompt} onRequest={() => void request()} />
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {error && <p className="border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300">{error}</p>}
              <TimeGrid days={days} events={events} hidden={hidden} selectedId={selected?.id ?? null} onSelect={setSelected} />
            </div>
            {selected && <EventDetails event={selected} onClose={() => setSelected(null)} />}
          </div>
        )}
      </div>
    </div>
  );
}

function AccessPrompt({ access, prompt, onRequest }: { access: string; prompt: "idle" | "asking" | "no-prompt"; onRequest: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="glass max-w-md rounded-2xl p-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-300">
          <IconCalendar size={22} />
        </span>
        <h2 className="text-base font-semibold text-slate-100">See your meetings here</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          Workbench reads the calendars on this Mac — including Outlook/Exchange once your work account is added in System
          Settings › Internet Accounts. It never changes them.
        </p>
        {access === "not_determined" && prompt !== "no-prompt" ? (
          <button className="btn btn-primary mt-4" onClick={onRequest} disabled={prompt === "asking"}>
            {prompt === "asking" ? "Waiting for your answer in macOS…" : "Allow calendar access"}
          </button>
        ) : access === "not_determined" ? (
          <>
            <p className="mt-3 text-xs text-amber-300">
              macOS did not show its permission prompt. Add Workbench under Privacy &amp; Security › Calendars (Full Access), then come back.
            </p>
            <div className="mt-3 flex justify-center gap-2">
              <button className="btn" onClick={openCalendarPrivacy}>
                Open Calendar privacy settings
              </button>
              <button className="btn" onClick={onRequest}>
                Try again
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-xs text-amber-300">
              Access was refused. Turn on Workbench under Privacy &amp; Security › Calendars (Full Access), then come back.
            </p>
            <button className="btn mt-3" onClick={openCalendarPrivacy}>
              Open Calendar privacy settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
