// Every meeting setting: detection, tasks, rounding, shortcuts, recurring
// entries and days off. Edited as a draft and saved in one go.

import { useEffect, useState } from "react";
import { meetingsApi } from "./api";
import { useMeetings } from "./MeetingProvider";
import type { Holiday, HolidayChoice, MeetingSettings, RecurringEntry, Shortcut } from "./types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const newId = () => Math.random().toString(36).slice(2, 10);
const num = (v: string) => (v.trim() === "" ? 0 : Math.max(0, Math.floor(Number(v) || 0)));

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="glass mb-3 rounded-2xl p-4">
      <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      {hint && <p className="mb-3 text-[11.5px] text-slate-500">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3 py-1">
      <span className="w-44 text-[12px] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

/** What would stop these settings from saving, in plain words. */
export function settingsProblem(s: MeetingSettings): string | null {
  if (s.step_minutes < 1 || s.step_minutes > 240) return "The rounding step must be 1–240 minutes.";
  if (s.min_minutes > 480) return "The minimum must be 8 hours or less.";
  if (s.reminder_minutes > 120) return "Reminders can be at most 2 hours before.";
  if (s.shortcuts.some((x) => !x.name.trim() || x.task_id <= 0)) return "Every shortcut needs a name and a task id.";
  if (s.recurring.some((r) => r.task_id <= 0 || !(r.hours > 0 && r.hours <= 8)))
    return "Every recurring entry needs a task id and 0–8 hours.";
  return null;
}

export function MeetingSettingsView() {
  const { settings, saveSettings } = useMeetings();
  const [draft, setDraft] = useState<MeetingSettings | null>(settings);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [holidays, setHolidays] = useState<{ fixed: Holiday[]; religious: Holiday[] } | null>(null);
  const [newDay, setNewDay] = useState("");
  // Bumped when the draft is replaced, so uncontrolled inputs reset too.
  const [revision, setRevision] = useState(0);
  const year = new Date().getFullYear();

  useEffect(() => {
    if (!draft && settings) setDraft(settings);
  }, [settings, draft]);

  useEffect(() => {
    if (draft?.region !== "morocco") return;
    let cancelled = false;
    meetingsApi
      .holidays(year)
      .then((h) => !cancelled && setHolidays(h))
      .catch(() => !cancelled && setHolidays(null));
    return () => {
      cancelled = true;
    };
  }, [draft?.region, year]);

  if (!draft) return <p className="text-xs text-slate-500">Loading…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const problem = settingsProblem(draft);
  const set = (patch: Partial<MeetingSettings>) => {
    setDraft({ ...draft, ...patch });
    setStatus(null);
  };
  const setShortcut = (id: string, patch: Partial<Shortcut>) =>
    set({ shortcuts: draft.shortcuts.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const setRecurring = (id: string, patch: Partial<RecurringEntry>) =>
    set({ recurring: draft.recurring.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  function choiceFor(h: Holiday): HolidayChoice {
    return draft!.holiday_choices.find((c) => c.key === h.key) ?? { key: h.key ?? "", date: h.date, on: true };
  }
  function setChoice(h: Holiday, patch: Partial<HolidayChoice>) {
    const next = { ...choiceFor(h), ...patch };
    set({ holiday_choices: [...draft!.holiday_choices.filter((c) => c.key !== next.key), next] });
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await saveSettings(draft!);
      setDraft(saved);
      setRevision((n) => n + 1);
      setStatus({ ok: true, text: "Saved" });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function logRecurringNow() {
    try {
      const done = await meetingsApi.runRecurring();
      setStatus({ ok: true, text: done.length ? `Logged ${done.join(", ")}` : "Nothing due today (already logged or a day off)." });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    }
  }

  return (
    <fieldset className="min-w-0 pb-16" disabled={saving}>
      <Group title="Detection">
        <label className="flex items-center gap-2 text-[12.5px] text-slate-300">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Detect meetings from microphone use
        </label>
      </Group>

      <Group title="Calendar reminders" hint="A notification before each scheduled meeting from your Mac's calendars. 0 turns it off.">
        <Field label="Remind me (minutes before)">
          <input className="input num w-24" inputMode="numeric" value={draft.reminder_minutes} onChange={(e) => set({ reminder_minutes: num(e.target.value) })} />
        </Field>
      </Group>

      <Group title="Tasks" hint="TargetProcess ids. Daily is the one-click option in the popup; the meeting task is pre-selected under “Choose a task”.">
        <Field label="Daily task">
          <input className="input num w-32" inputMode="numeric" value={draft.daily_task_id || ""} placeholder="e.g. 12345" onChange={(e) => set({ daily_task_id: num(e.target.value) })} />
        </Field>
        <Field label="Default meeting task">
          <input className="input num w-32" inputMode="numeric" value={draft.meetings_task_id || ""} placeholder="optional" onChange={(e) => set({ meetings_task_id: num(e.target.value) })} />
        </Field>
      </Group>

      <Group title="Rounding" hint="Each meeting counts for at least the minimum and is rounded up to the step.">
        <Field label="Minimum (minutes)">
          <input className="input num w-24" inputMode="numeric" value={draft.min_minutes} onChange={(e) => set({ min_minutes: num(e.target.value) })} />
        </Field>
        <Field label="Round up to (minutes)">
          <input className="input num w-24" inputMode="numeric" value={draft.step_minutes} onChange={(e) => set({ step_minutes: num(e.target.value) })} />
        </Field>
      </Group>

      <Group title="Meeting shortcuts" hint="Recurring meetings you log to a fixed task, shown as one-click options in the popup.">
        <div className="space-y-2">
          {draft.shortcuts.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2">
              <input className="input w-44" placeholder="Name (e.g. Sprint review)" value={s.name} onChange={(e) => setShortcut(s.id, { name: e.target.value })} />
              <input className="input num w-28" inputMode="numeric" placeholder="Task id" value={s.task_id || ""} onChange={(e) => setShortcut(s.id, { task_id: num(e.target.value) })} />
              <input className="input min-w-40 flex-1" placeholder="Description (optional)" value={s.description} onChange={(e) => setShortcut(s.id, { description: e.target.value })} />
              <button className="btn" onClick={() => set({ shortcuts: draft.shortcuts.filter((x) => x.id !== s.id) })} aria-label="Remove shortcut">
                ×
              </button>
            </div>
          ))}
          <button className="btn" onClick={() => set({ shortcuts: [...draft.shortcuts, { id: newId(), name: "", task_id: 0, description: "" }] })}>
            + Shortcut
          </button>
        </div>
      </Group>

      <Group title="Recurring time" hint="Logged automatically once per working day (skipping days off). Time already on that task today is not duplicated.">
        <div className="space-y-2">
          {draft.recurring.map((r) => (
            <div key={`${r.id}-${revision}`} className="flex flex-wrap items-center gap-2">
              <input className="input min-w-40 flex-1" placeholder="Label (e.g. Daily standup)" value={r.label} onChange={(e) => setRecurring(r.id, { label: e.target.value })} />
              <input className="input num w-28" inputMode="numeric" placeholder="Task id" value={r.task_id || ""} onChange={(e) => setRecurring(r.id, { task_id: num(e.target.value) })} />
              <input
                className="input num w-20"
                inputMode="decimal"
                placeholder="Hours"
                defaultValue={r.hours || ""}
                onChange={(e) => setRecurring(r.id, { hours: Number(e.target.value.replace(",", ".")) || 0 })}
              />
              <span className="text-[11px] text-slate-500">h</span>
              <button className="btn" onClick={() => set({ recurring: draft.recurring.filter((x) => x.id !== r.id) })} aria-label="Remove recurring entry">
                ×
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <button className="btn" onClick={() => set({ recurring: [...draft.recurring, { id: newId(), label: "", task_id: 0, hours: 0.25 }] })}>
              + Recurring entry
            </button>
            {draft.recurring.length > 0 && (
              <button className="btn" onClick={() => void logRecurringNow()} disabled={dirty} title={dirty ? "Save first" : "Log what's due today now"}>
                Log today's now
              </button>
            )}
          </div>
        </div>
      </Group>

      <Group title="Days off" hint="No recurring time is logged on these days.">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d, i) => {
            const iso = i + 1;
            const off = draft.weekly_off.includes(iso);
            return (
              <button
                key={d}
                onClick={() => set({ weekly_off: off ? draft.weekly_off.filter((x) => x !== iso) : [...draft.weekly_off, iso] })}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] ${off ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-[var(--line)] text-slate-400"}`}
                title={off ? "Day off every week" : "Working day"}
              >
                {d}
              </button>
            );
          })}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input type="date" className="input text-xs" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
          <button
            className="btn"
            disabled={!newDay || draft.days_off.includes(newDay)}
            onClick={() => {
              set({ days_off: [...draft.days_off, newDay].sort() });
              setNewDay("");
            }}
          >
            + Day off
          </button>
          {draft.days_off.map((d) => (
            <span key={d} className="chip num">
              {d}
              <button className="ml-1 text-slate-500 hover:text-slate-200" onClick={() => set({ days_off: draft.days_off.filter((x) => x !== d) })} aria-label={`Remove ${d}`}>
                ×
              </button>
            </span>
          ))}
        </div>

        <Field label="Public holidays">
          <select className="input text-xs" value={draft.region} onChange={(e) => set({ region: e.target.value as MeetingSettings["region"] })}>
            <option value="none">None</option>
            <option value="morocco">Morocco</option>
          </select>
        </Field>

        {draft.region === "morocco" && holidays && (
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div>
              <div className="label mb-1">Civil holidays {year}</div>
              <ul className="space-y-0.5 text-[12px] text-slate-400">
                {holidays.fixed.map((h) => (
                  <li key={h.date} className="flex gap-2">
                    <span className="num text-slate-500">{h.date.slice(5)}</span>
                    {h.name}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="label mb-1">Religious holidays {year} (estimates — confirm or move)</div>
              {holidays.religious.length === 0 ? (
                <p className="text-[11.5px] text-slate-500">No estimates for {year}; add them as days off.</p>
              ) : (
                <ul className="space-y-1 text-[12px] text-slate-300">
                  {holidays.religious.map((h) => {
                    const c = choiceFor(h);
                    return (
                      <li key={h.key} className="flex items-center gap-2">
                        <input type="checkbox" checked={c.on} onChange={(e) => setChoice(h, { on: e.target.checked })} />
                        <input type="date" className="input py-0.5 text-xs" value={c.date} onChange={(e) => e.target.value && setChoice(h, { date: e.target.value })} />
                        <span className="truncate">{h.name}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Group>

      <div className="sticky bottom-0 flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--panel-solid)] px-4 py-3">
        {status && <span className={`text-xs ${status.ok ? "text-emerald-300" : "text-rose-300"}`}>{status.text}</span>}
        <button className="btn ml-auto" disabled={!dirty || saving} onClick={() => {
            setDraft(settings);
            setRevision((n) => n + 1);
          }}>
          Discard
        </button>
        {problem && <span className="text-xs text-amber-300">{problem}</span>}
        <button className="btn btn-primary" disabled={!dirty || saving || !!problem} onClick={() => void save()}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </fieldset>
  );
}
