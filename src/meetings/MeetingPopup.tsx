// Shown when a meeting ends: confirm the hours, pick where they go (daily,
// a saved shortcut or any task) and log them, or ignore the meeting.

import { useOverlay } from "../shared/overlay";
import { useEffect, useMemo, useRef, useState } from "react";
import { tpwQuery } from "../tp-workspace/api";
import { formatHours } from "../tp-workspace/logic/duration";
import type { TpWorkItem } from "../tp-workspace/types";
import { meetingsApi } from "./api";
import { appNames, billableHours, clock, matchShortcut, minutesBetween, parseHours } from "./logic";
import type { MeetingSettings, PendingMeeting } from "./types";

type Choice = { kind: "daily" } | { kind: "shortcut"; id: string } | { kind: "task" };

interface Props {
  meeting: PendingMeeting;
  /** Other meetings still waiting to be logged. */
  waiting: number;
  settings: MeetingSettings;
  /** Called with the id of the meeting just logged or ignored. */
  onDone: (id: string) => void;
  onLater: () => void;
  /** Tells the provider which meeting is being logged (null when done). */
  onLogging: (id: string | null) => void;
}

function useMyWork(): TpWorkItem[] {
  const [items, setItems] = useState<TpWorkItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    const take = (r: { payload: TpWorkItem[] } | null) => !cancelled && r && setItems(r.payload);
    tpwQuery<TpWorkItem[]>({ kind: "my_work" }, false)
      .then(take)
      .catch(() => {})
      .finally(() => tpwQuery<TpWorkItem[]>({ kind: "my_work" }, true).then(take).catch(() => {}));
    return () => {
      cancelled = true;
    };
  }, []);
  return items;
}

export function MeetingPopup({ meeting, waiting, settings, onDone, onLater, onLogging }: Props) {
  useOverlay();
  const minutes = minutesBetween(meeting.start, meeting.end);
  const [hoursText, setHoursText] = useState(() =>
    String(Math.round(billableHours(minutes, settings.min_minutes, settings.step_minutes) * 100) / 100),
  );
  // A shortcut named like the scheduled meeting wins; then Daily.
  const matched = matchShortcut(meeting.title, settings.shortcuts);
  const firstChoice: Choice = matched
    ? { kind: "shortcut", id: matched.id }
    : settings.daily_task_id > 0
      ? { kind: "daily" }
      : settings.shortcuts[0]
        ? { kind: "shortcut", id: settings.shortcuts[0].id }
        : { kind: "task" };
  const [choice, setChoice] = useState<Choice>(firstChoice);
  const [taskId, setTaskId] = useState<number | null>(settings.meetings_task_id > 0 ? settings.meetings_task_id : null);
  const [query, setQuery] = useState("");
  const shortcutText = (id: string) => {
    const sc = settings.shortcuts.find((x) => x.id === id);
    return sc?.description || meeting.title || sc?.name || "";
  };
  const [description, setDescription] = useState(
    firstChoice.kind === "shortcut" ? shortcutText(firstChoice.id) : (meeting.title ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const work = useMyWork();
  const hoursInput = useRef<HTMLInputElement>(null);

  useEffect(() => hoursInput.current?.select(), []);

  const open = useMemo(() => work.filter((i) => !i.state.is_final), [work]);
  const names = useMemo(() => new Map(work.map((i) => [i.id, i.name])), [work]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    const list = q ? open.filter((i) => String(i.id).includes(q) || i.name.toLowerCase().includes(q)) : open;
    return list.slice(0, 40);
  }, [open, query]);
  // A typed id that isn't in my list can still be logged to.
  const typedId = /^#?\d{2,}$/.test(query.trim()) ? Number(query.trim().replace("#", "")) : null;

  const shortcut = choice.kind === "shortcut" ? settings.shortcuts.find((s) => s.id === choice.id) : undefined;
  const target =
    choice.kind === "daily" ? settings.daily_task_id : choice.kind === "shortcut" ? (shortcut?.task_id ?? null) : taskId;
  const hours = parseHours(hoursText);
  const canLog = !busy && hours !== null && !!target && target > 0;

  function pick(next: Choice) {
    // A shortcut's description belongs to that shortcut only.
    if (next.kind === "shortcut") {
      setDescription(shortcutText(next.id));
    } else if (choice.kind === "shortcut") {
      setDescription(meeting.title ?? "");
    }
    setChoice(next);
    setError(null);
  }

  async function log() {
    if (!canLog || hours === null || !target) return;
    setBusy(true);
    setError(null);
    try {
      // TargetProcess needs a description; name the choice when none is typed.
      onLogging(meeting.id);
      const text = description.trim() || (choice.kind === "daily" ? "Daily" : (shortcut?.name ?? ""));
      await meetingsApi.log(meeting.id, target, hours, text);
      onDone(meeting.id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    } finally {
      onLogging(null);
    }
  }

  async function ignore() {
    setBusy(true);
    try {
      await meetingsApi.dismiss(meeting.id);
      onDone(meeting.id);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const option = (active: boolean, disabled = false) =>
    `flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] ${
      disabled
        ? "cursor-not-allowed border-[var(--line)] text-slate-600"
        : active
          ? "border-[rgb(34_211_238/0.5)] bg-[rgb(34_211_238/0.1)] text-slate-100"
          : "border-[var(--line)] text-slate-300 hover:border-[var(--line-strong)]"
    }`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Log meeting time"
        onSubmit={(e) => {
          e.preventDefault();
          void log();
        }}
        onKeyDown={(e) => {
          // Only while focus is in the popup, so other dialogs keep their Esc.
          if (e.key === "Escape" && !busy) {
            e.preventDefault();
            e.stopPropagation();
            onLater();
          }
        }}
        className="animate-rise flex max-h-[calc(100vh-48px)] w-[560px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-solid)] shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[rgb(34_211_238/0.08)] px-5 py-3">
          <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_#22d3ee]" />
          <h2 className="truncate text-[14px] font-semibold text-slate-100">{meeting.title ?? "Meeting ended"}</h2>
          <span className="num text-[12px] text-slate-400">
            {clock(meeting.start)}–{clock(meeting.end)} · {Math.round(minutes)} min
            {meeting.apps.length > 0 && ` · ${appNames(meeting.apps)}`}
          </span>
          {waiting > 0 && <span className="num chip ml-auto py-0">+{waiting} more to log</span>}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="flex items-center gap-3">
            <span className="label w-24">Hours to log</span>
            <input
              ref={hoursInput}
              className="input num w-24 text-right"
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
              inputMode="decimal"
              aria-invalid={hours === null}
            />
            <span className="text-[11px] text-slate-500">
              {hours === null ? "Enter between 0 and 12" : formatHours(hours)}
            </span>
          </label>

          <div className="space-y-1.5">
            <span className="label">Log to</span>
            <button
              type="button"
              className={option(choice.kind === "daily", settings.daily_task_id <= 0)} aria-pressed={choice.kind === "daily"}
              disabled={settings.daily_task_id <= 0}
              onClick={() => pick({ kind: "daily" })}
            >
              <span className="font-medium">Daily</span>
              {settings.daily_task_id > 0 ? (
                <span className="num ml-auto truncate text-[11px] text-slate-500">
                  #{settings.daily_task_id} {names.get(settings.daily_task_id) ?? ""}
                </span>
              ) : (
                <span className="ml-auto text-[11px]">Set your daily task in Meetings › Settings</span>
              )}
            </button>
            {settings.shortcuts.map((s) => (
              <button
                key={s.id}
                type="button"
                className={option(choice.kind === "shortcut" && choice.id === s.id)} aria-pressed={choice.kind === "shortcut" && choice.id === s.id}
                onClick={() => pick({ kind: "shortcut", id: s.id })}
              >
                <span className="font-medium">{s.name}</span>
                <span className="num ml-auto text-[11px] text-slate-500">#{s.task_id}</span>
              </button>
            ))}
            <button type="button" className={option(choice.kind === "task")} aria-pressed={choice.kind === "task"} onClick={() => pick({ kind: "task" })}>
              <span className="font-medium">Choose a task</span>
              {choice.kind === "task" && taskId && (
                <span className="num ml-auto truncate text-[11px] text-slate-400">
                  #{taskId} {names.get(taskId) ?? ""}
                </span>
              )}
            </button>
            {choice.kind === "task" && (
              <div className="rounded-xl border border-[var(--line)] p-2">
                <input
                  className="input mb-2 w-full text-xs"
                  placeholder="Search your items, or type a task id"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter picks the match instead of logging straight away.
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (typedId !== null && !names.has(typedId)) setTaskId(typedId);
                    else if (matches.length === 1) setTaskId(matches[0].id);
                  }}
                  autoFocus
                />
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {typedId !== null && !names.has(typedId) && (
                    <li>
                      <button type="button" className={option(taskId === typedId)} aria-pressed={taskId === typedId} onClick={() => setTaskId(typedId)}>
                        Use #{typedId}
                      </button>
                    </li>
                  )}
                  {matches.map((i) => (
                    <li key={i.id}>
                      <button type="button" className={option(taskId === i.id)} aria-pressed={taskId === i.id} onClick={() => setTaskId(i.id)}>
                        <span className="num shrink-0 text-[11px] text-slate-500">#{i.id}</span>
                        <span className="truncate">{i.name}</span>
                        <span className="ml-auto shrink-0 text-[10.5px] text-slate-500">{i.entity_type === "UserStory" ? "Story" : i.entity_type}</span>
                      </button>
                    </li>
                  ))}
                  {matches.length === 0 && typedId === null && (
                    <li className="px-2 py-3 text-center text-[11px] text-slate-500">
                      {work.length ? "No match" : "Loading your items…"}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <label className="block space-y-1.5">
            <span className="label">Description (optional)</span>
            <input className="input w-full" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it about?" />
          </label>

          {error && <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-[var(--line)] px-5 py-3">
          <button type="button" className="btn" onClick={() => void ignore()} disabled={busy} title="Don't log this meeting">
            Ignore
          </button>
          <button type="button" className="btn" onClick={onLater} disabled={busy} title="Keep it in the to-log list (Esc)">
            Later
          </button>
          <button type="submit" className="btn btn-primary ml-auto" disabled={!canLog}>
            {busy ? "Logging…" : hours !== null && target ? `Log ${formatHours(hours)} to #${target}` : "Log"}
          </button>
        </div>
      </form>
    </div>
  );
}
