// Day or week time grid, like Calendar: hours down the side, one column per
// day, all-day events on top, a red line at the current time.

import { useEffect, useMemo, useRef } from "react";
import { useNow } from "../meetings/useNow";
import { allDayOn, layoutDay, MINUTES_PER_DAY, sameDay, timeLabel } from "./logic";
import type { CalEvent } from "./types";

const HOUR_PX = 52;
const PX_PER_MIN = HOUR_PX / 60;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Props {
  days: Date[];
  events: CalEvent[];
  hidden: Set<string>;
  selectedId: string | null;
  onSelect: (e: CalEvent) => void;
}

export function TimeGrid({ days, events, hidden, selectedId, onSelect }: Props) {
  const now = useNow(true, 30_000);
  const scroller = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => events.filter((e) => !hidden.has(e.calendar.id)), [events, hidden]);
  const showsToday = days.some((d) => sameDay(d, new Date(now)));

  // Open on the working day: an hour before now, or 8:00.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const d = new Date();
    const minutes = showsToday ? d.getHours() * 60 + d.getMinutes() - 60 : 8 * 60;
    el.scrollTop = Math.max(0, minutes * PX_PER_MIN);
    // Only when the range changes, not on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.getTime(), days.length]);

  const allDay = days.map((d) => allDayOn(visible, d));
  const hasAllDay = allDay.some((list) => list.length > 0);
  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 border-b border-[var(--line)]" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => {
          const today = sameDay(d, new Date(now));
          return (
            <div key={d.getTime()} className="flex items-baseline gap-1.5 border-l border-[var(--line)] px-2 py-2">
              <span className={`text-[11px] uppercase ${today ? "text-rose-300" : "text-slate-500"}`}>{WEEKDAYS[d.getDay()]}</span>
              <span
                className={`num flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-semibold ${
                  today ? "bg-rose-500 text-white" : "text-slate-200"
                }`}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="grid shrink-0 border-b border-[var(--line)]" style={{ gridTemplateColumns: cols }}>
          <div className="px-1 py-1 text-right text-[9.5px] text-slate-600">all-day</div>
          {allDay.map((list, i) => (
            <div key={i} className="space-y-0.5 border-l border-[var(--line)] p-1">
              {list.map((e) => (
                <button
                  key={e.id}
                  onClick={() => onSelect(e)}
                  className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] text-slate-100"
                  style={{ background: `${e.calendar.color}40`, outline: selectedId === e.id ? `1px solid ${e.calendar.color}` : undefined }}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative grid" style={{ gridTemplateColumns: cols, height: MINUTES_PER_DAY * PX_PER_MIN }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="num absolute right-2 -translate-y-1/2 text-[10px] text-slate-600" style={{ top: h * HOUR_PX }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <DayColumn key={d.getTime()} day={d} events={visible} now={now} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  events,
  now,
  selectedId,
  onSelect,
}: {
  day: Date;
  events: CalEvent[];
  now: number;
  selectedId: string | null;
  onSelect: (e: CalEvent) => void;
}) {
  const placed = useMemo(() => layoutDay(events, day), [events, day]);
  const isToday = sameDay(day, new Date(now));
  const nowTop = (now - day.getTime()) / 60000;
  const weekend = day.getDay() === 0 || day.getDay() === 6;

  return (
    <div className={`relative border-l border-[var(--line)] ${weekend ? "bg-white/[0.012]" : ""}`}>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="absolute inset-x-0 border-t border-[var(--line-soft)]" style={{ top: h * HOUR_PX }} />
      ))}
      {placed.map(({ event: e, top, height, column, columns }) => {
        const past = Date.parse(e.end) < now;
        const declined = e.my_status === "declined";
        const short = height < 35;
        const tiny = height < 22;
        return (
          <button
            key={e.id}
            onClick={() => onSelect(e)}
            className={`absolute overflow-hidden rounded-md border-l-[3px] px-1.5 text-left leading-tight transition-[filter] hover:brightness-125 ${
              tiny ? "py-0 text-[10px] leading-none" : "py-0.5 text-[11px]"
            } ${past ? "opacity-55" : ""}`}
            style={{
              top: top * PX_PER_MIN + 1,
              height: height * PX_PER_MIN - 2,
              left: `calc(${(column / columns) * 100}% + 2px)`,
              width: `calc(${100 / columns}% - 4px)`,
              background: `${e.calendar.color}${selectedId === e.id ? "55" : "30"}`,
              borderColor: e.calendar.color,
              outline: selectedId === e.id ? `1px solid ${e.calendar.color}` : undefined,
            }}
            title={`${e.title} · ${timeLabel(e.start)}–${timeLabel(e.end)}`}
          >
            <span className={`font-medium text-slate-50 ${declined ? "line-through opacity-70" : ""}`}>{e.title}</span>
            {short ? (
              <span className="num ml-1 text-slate-300/80">{timeLabel(e.start)}</span>
            ) : (
              <span className="num block text-slate-300/80">
                {timeLabel(e.start)}–{timeLabel(e.end)}
              </span>
            )}
            {!short && e.location && <span className="block truncate text-slate-400">{e.location}</span>}
          </button>
        );
      })}
      {isToday && nowTop >= 0 && nowTop <= MINUTES_PER_DAY && (
        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop * PX_PER_MIN }}>
          <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-rose-500" />
          <div className="h-px bg-rose-500" />
        </div>
      )}
    </div>
  );
}

