import { useEffect, useState } from "react";
import { useTabActive } from "../../shell/TabContext";
import { openInTp, tpwLogTime, tpwSetState, tpwStates } from "../api";
import { requestRefresh } from "../hooks/useTpwQuery";
import { formatDay } from "../logic/dates";
import { formatHours } from "../logic/duration";
import { overdueInfo } from "../logic/work";
import { useWorkspace } from "../WorkspaceContext";
import type { TpEntityState, TpWorkItem } from "../types";
import { IconClose, IconExternal } from "./icons";
import { Avatars, Progress, ProjectTag, StatePill, TypeBadge, TpId } from "./ui";

export function ItemDrawer() {
  const { openItem, setOpenItem } = useWorkspace();

  const tabActive = useTabActive();
  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenItem(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabActive, setOpenItem]);

  if (!openItem) return null;
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px]" onClick={() => setOpenItem(null)} />
      <aside className="glass-strong animate-rise fixed inset-y-3 right-3 z-40 flex w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl shadow-2xl">
        <DrawerBody key={openItem.id} item={openItem} onClose={() => setOpenItem(null)} />
      </aside>
    </>
  );
}

function DrawerBody({ item, onClose }: { item: TpWorkItem; onClose: () => void }) {
  const { today } = useWorkspace();
  const overdue = overdueInfo(item, today);
  const progress = item.effort > 0 ? (item.effort_completed / item.effort) * 100 : item.state.is_final ? 100 : 0;

  return (
    <>
      <div className="flex items-start gap-3 border-b border-[var(--line)] p-5">
        <TypeBadge type={item.entity_type} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-slate-500"><TpId id={item.id} /></div>
          <h2 className="mt-0.5 text-[15px] font-semibold leading-snug text-slate-100">{item.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatePill name={item.state.name} isFinal={item.state.is_final} />
            <ProjectTag projectId={item.project_id} name={item.project_name} />
            {item.tags.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        </div>
        <button className="rounded-md p-1 text-slate-500 hover:text-slate-200" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {overdue && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            <span className="num font-semibold">{overdue.daysLate}d late</span> —{" "}
            {overdue.reason === "sprint_ended" ? "its sprint ended" : "planned end"} {formatDay(overdue.dueDate)}
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <Field label="Sprint" value={item.sprint_name || "—"} />
          <Field label="Team" value={item.team_name || "—"} />
          {item.user_story_name && <Field label="User story" value={<>{item.user_story_id !== null && <TpId id={item.user_story_id} />} {item.user_story_name}</>} wide />}
          <Field label="Planned end" value={item.planned_end_date ? formatDay(item.planned_end_date) : "—"} />
          <Field label="Assigned" value={<Avatars people={item.assigned} />} />
        </dl>

        <div className="glass rounded-xl p-3">
          <div className="mb-2 flex justify-between text-[11px] text-slate-500">
            <span className="label">Effort</span>
            <span className="num">
              {item.effort_completed}/{item.effort}pt · {formatHours(item.time_spent)} spent · {formatHours(item.time_remain)} left
            </span>
          </div>
          <Progress value={progress} tone={item.state.is_final ? "good" : "accent"} />
        </div>

        <StateSwitcher item={item} />
        <LogTimeForm item={item} />
      </div>

      <div className="border-t border-[var(--line)] p-4">
        <button className="btn w-full justify-center" onClick={() => void openInTp(item.id)}>
          <IconExternal size={14} /> Open in TargetProcess
        </button>
      </div>
    </>
  );
}

function Field({ label, value, wide }: { label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="label">{label}</dt>
      <dd className="mt-1 truncate text-slate-300">{value}</dd>
    </div>
  );
}

function StateSwitcher({ item }: { item: TpWorkItem }) {
  const [states, setStates] = useState<TpEntityState[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (item.process_id === null) return;
    tpwStates(item.process_id, item.entity_type)
      .then(setStates)
      .catch((e) => setMessage({ ok: false, text: String(e) }));
  }, [item.process_id, item.entity_type]);

  async function move(state: TpEntityState) {
    setBusy(state.id);
    setMessage(null);
    try {
      await tpwSetState(item.entity_type, item.id, state.id);
      setMessage({ ok: true, text: `Moved to ${state.name}` });
      requestRefresh();
    } catch (e) {
      setMessage({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="label mb-2">Move to</div>
      {item.process_id === null ? (
        <p className="text-xs text-slate-500">Workflow unknown for this item.</p>
      ) : !states ? (
        <div className="skeleton h-8" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {states.map((s) => {
            const current = s.id === item.state.id;
            return (
              <button
                key={s.id}
                disabled={current || busy !== null}
                onClick={() => void move(s)}
                className={`chip transition-colors ${
                  current ? "border-[var(--acc-500)] text-sky-300" : "hover:border-[var(--line-strong)] hover:text-slate-100"
                }`}
              >
                {busy === s.id ? "…" : s.name}
              </button>
            );
          })}
        </div>
      )}
      {message && <p className={`mt-2 text-xs ${message.ok ? "text-emerald-400" : "text-rose-400"}`}>{message.text}</p>}
    </section>
  );
}

function LogTimeForm({ item }: { item: TpWorkItem }) {
  const { today } = useWorkspace();
  const [hours, setHours] = useState("1");
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(hours);
    if (!Number.isFinite(value) || value <= 0 || value > 24) {
      setMessage({ ok: false, text: "Enter between 0 and 24 hours." });
      return;
    }
    if (!description.trim()) {
      setMessage({ ok: false, text: "Add a description — TargetProcess requires one." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await tpwLogTime(item.id, value, description, date);
      setMessage({ ok: true, text: `Logged ${formatHours(value)} on ${formatDay(date)}` });
      setDescription("");
      requestRefresh();
    } catch (err) {
      setMessage({ ok: false, text: String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="label mb-2">Log time</div>
      <div className="flex gap-2">
        <div className="flex gap-1">
          {[0.5, 1, 2, 4].map((h) => (
            <button
              type="button"
              key={h}
              onClick={() => setHours(String(h))}
              className={`chip num ${Number(hours) === h ? "border-[var(--acc-500)] text-sky-300" : ""}`}
            >
              {formatHours(h)}
            </button>
          ))}
        </div>
        <input
          className="input num w-20"
          type="number"
          step="0.25"
          min="0.25"
          max="24"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          aria-label="Hours"
        />
      </div>
      <div className="mt-2 flex gap-2">
        <input className="input num w-40" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        <input
          className="input flex-1"
          placeholder="What did you do?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <button className="btn btn-primary mt-2 w-full justify-center" disabled={busy}>
        {busy ? "Logging…" : "Log time"}
      </button>
      {message && <p className={`mt-2 text-xs ${message.ok ? "text-emerald-400" : "text-rose-400"}`}>{message.text}</p>}
    </form>
  );
}
