// Side panel for one event: when, where, who, notes, and Join.

import { IconClose } from "../shared/icons";
import { join } from "./api";
import { timeLabel, untilLabel } from "./logic";
import type { CalEvent } from "./types";

const STATUS: Record<string, { label: string; color: string }> = {
  accepted: { label: "Accepted", color: "#34d399" },
  tentative: { label: "Maybe", color: "#fbbf24" },
  declined: { label: "Declined", color: "#fb7185" },
  pending: { label: "No answer", color: "#94a3b8" },
};

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

/** Notes from Outlook carry long separator lines and dial-in boilerplate. */
function tidyNotes(notes: string): string {
  return notes
    .replace(/_{8,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function EventDetails({ event, onClose }: { event: CalEvent; onClose: () => void }) {
  const mine = event.my_status ? STATUS[event.my_status] : undefined;
  const others = event.attendees.filter((a) => !a.is_me);

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--panel)]">
      <div className="flex items-start gap-2 border-b border-[var(--line)] px-4 py-3">
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: event.calendar.color }} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-snug text-slate-50">{event.title}</h2>
          <p className="mt-0.5 text-[11.5px] text-slate-400">{event.calendar.title}</p>
        </div>
        <button className="rounded p-1 text-slate-500 hover:bg-[var(--line)] hover:text-slate-100" onClick={onClose} aria-label="Close details">
          <IconClose size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-[12.5px]">
        <div>
          <div className="text-slate-200">{dateLabel(event.start)}</div>
          <div className="num text-slate-400">
            {event.all_day ? "All day" : `${timeLabel(event.start)} – ${timeLabel(event.end)}`}
            {!event.all_day && <span className="ml-2 text-slate-500">{untilLabel(event, Date.now())}</span>}
          </div>
        </div>

        {event.join_url && (
          <button className="btn btn-primary w-full justify-center" onClick={() => join(event)}>
            Join meeting
          </button>
        )}

        {event.location && (
          <div>
            <div className="label mb-0.5">Location</div>
            <div className="break-words text-slate-300">{event.location}</div>
          </div>
        )}

        {(event.organizer || mine) && (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {event.organizer && (
              <div>
                <div className="label mb-0.5">Organiser</div>
                <div className="text-slate-300">{event.organizer}</div>
              </div>
            )}
            {mine && (
              <div>
                <div className="label mb-0.5">Your answer</div>
                <div style={{ color: mine.color }}>{mine.label}</div>
              </div>
            )}
          </div>
        )}

        {others.length > 0 && (
          <div>
            <div className="label mb-1">Attendees · {others.length}</div>
            <ul className="space-y-1">
              {others.map((a, i) => (
                <li key={`${a.email ?? a.name}-${i}`} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS[a.status]?.color ?? "#64748b" }} title={STATUS[a.status]?.label} />
                  <span className="truncate text-slate-300">{a.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {event.notes && (
          <div>
            <div className="label mb-1">Notes</div>
            <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-400">{tidyNotes(event.notes)}</p>
          </div>
        )}
      </div>
    </aside>
  );
}
