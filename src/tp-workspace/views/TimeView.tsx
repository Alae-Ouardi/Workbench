import { useEffect, useMemo, useState } from "react";
import { useTabActive } from "../../shell/TabContext";
import { openInTp } from "../api";
import { IconChevronLeft, IconChevronRight, IconClock, IconExternal } from "../components/icons";
import { ErrorBanner, Kpi, Progress, SkeletonRows, ViewHeader, TpId } from "../components/ui";
import { useTpwQuery } from "../hooks/useTpwQuery";
import { addDays, eachDay, formatDay, formatMonth, monthGrid, shiftMonth, startOfWeek, WEEKDAYS } from "../logic/dates";
import { formatHours } from "../logic/duration";
import { byProject, dayStatus, gapDays, groupByDay, monthTarget, totalFor, weekTotal, type DayLog, type DayStatus } from "../logic/timesheet";
import { sum } from "../logic/work";
import { useLocalState, usePrefs } from "../prefs";
import { useWorkspace } from "../WorkspaceContext";
import type { TpTimeEntry } from "../types";

type Mode = "month" | "week";

const STATUS_STYLE: Record<DayStatus, { ring: string; text: string; label: string }> = {
  met: { ring: "rgb(16 185 129 / 0.45)", text: "#34d399", label: "Target met" },
  short: { ring: "rgb(251 191 36 / 0.45)", text: "#fbbf24", label: "Under target" },
  empty: { ring: "rgb(251 113 133 / 0.5)", text: "#fb7185", label: "Nothing logged" },
  off: { ring: "transparent", text: "var(--ink-600)", label: "Day off" },
  future: { ring: "transparent", text: "var(--ink-700)", label: "" },
};

export function TimeView() {
  const { today, filters } = useWorkspace();
  const projectFilterOn = filters.projectIds.length > 0;
  const { prefs } = usePrefs();
  const [mode, setMode] = useLocalState<Mode>("tpw.time.mode", "month");
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState<string | null>(today);
  const rules = { dailyTargetHours: prefs.daily_target_hours, workingDays: prefs.working_days };

  const weeks = useMemo(
    () => (mode === "month" ? monthGrid(anchor) : [eachDay(startOfWeek(anchor), addDays(startOfWeek(anchor), 6))]),
    [mode, anchor],
  );
  // Always load the anchor's whole month grid too, so the month KPI is right
  // in week mode.
  const grid = monthGrid(anchor);
  const from = weeks[0][0] < grid[0][0] ? weeks[0][0] : grid[0][0];
  const lastWeek = weeks[weeks.length - 1][6];
  const lastGrid = grid[grid.length - 1][6];
  const to = lastWeek > lastGrid ? lastWeek : lastGrid;
  const q = useTpwQuery<TpTimeEntry[]>({ kind: "times", from, to });

  // Every project counts: the day / week / month targets are about all the
  // hours you logged, so the workspace project filter is deliberately not
  // applied here (it once hid time logged on other projects).
  const entries = q.data ?? [];
  const days = useMemo(() => groupByDay(entries), [entries]);
  const inPeriod = (d: string) => (mode === "month" ? d.slice(0, 7) === anchor.slice(0, 7) : true);
  const periodDays = weeks.flat().filter(inPeriod);
  const gaps = gapDays(days, periodDays[0], periodDays[periodDays.length - 1], today, rules);

  // Targets: day, week (the anchor's week) and month (the anchor's month).
  const weeklyTarget = prefs.weekly_target_hours;
  const anchorWeek = eachDay(startOfWeek(anchor), addDays(startOfWeek(anchor), 6));
  const weekLogged = totalFor(days, anchorWeek);
  const monthDays = monthGrid(anchor).flat().filter((d) => d.slice(0, 7) === anchor.slice(0, 7));
  const monthLogged = totalFor(days, monthDays);
  const monthGoal = monthTarget(anchor, weeklyTarget, rules.workingDays, prefs.monthly_target_hours);
  const todayLogged = days.get(today)?.total ?? 0;

  function move(step: number) {
    const next = mode === "month" ? shiftMonth(anchor, step) : addDays(anchor, step * 7);
    setAnchor(next);
    // Keep the breakdown on a day that is visible in the new period.
    setSelected(mode === "month" ? (today.slice(0, 7) === next.slice(0, 7) ? today : next) : startOfWeek(next));
  }

  function goToday() {
    setAnchor(today);
    setSelected(today);
  }

  // ← / → step through periods, T jumps back to today.
  const tabActive = useTabActive();
  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "t") goToday();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const periodLabel = mode === "month" ? formatMonth(anchor) : `Week of ${formatDay(startOfWeek(anchor))}`;

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">
        <ViewHeader
          title="Time tracking"
          subtitle={`Your logged time · targets ${formatHours(rules.dailyTargetHours)} a day · ${formatHours(weeklyTarget)} a week · ${formatHours(monthGoal)} in ${formatMonth(anchor)}`}
          refreshing={q.refreshing}
          fetchedAt={q.fetchedAt}
          onRefresh={q.refresh}
          actions={
            <>
              <div className="flex rounded-lg border border-[var(--line)] p-0.5">
                {(["month", "week"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded-md px-2.5 py-1 text-xs capitalize ${mode === m ? "bg-[var(--line)] text-slate-100" : "text-slate-500"}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <button className="btn" onClick={() => move(-1)} title={`Previous ${mode} (←)`}>
                  <IconChevronLeft size={14} /> Prev
                </button>
                <span className="num min-w-36 text-center text-xs font-semibold text-slate-200">{periodLabel}</span>
                <button className="btn" onClick={() => move(1)} title={`Next ${mode} (→)`}>
                  Next <IconChevronRight size={14} />
                </button>
                <button className="btn" onClick={goToday} title="Back to today (T)">
                  Today
                </button>
                <input
                  type="month"
                  className="input num w-36"
                  value={anchor.slice(0, 7)}
                  max={today.slice(0, 7)}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const first = `${e.target.value}-01`;
                    setAnchor(first);
                    setSelected(first);
                  }}
                  title="Jump to a month"
                />
              </div>
            </>
          }
        />
        <ErrorBanner error={q.error} />
        {projectFilterOn && (
          <p className="mb-3 text-[11px] text-slate-500">
            Hours here include every project — the project filter doesn't apply to your timesheet.
          </p>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TargetKpi label="Today" logged={todayLogged} target={rules.dailyTargetHours} />
          <TargetKpi label={`Week of ${formatDay(anchorWeek[0])}`} logged={weekLogged} target={weeklyTarget} />
          <TargetKpi label={formatMonth(anchor)} logged={monthLogged} target={monthGoal} />
          <Kpi
            label="Gap days"
            value={gaps.length}
            tone={gaps.length ? "warn" : "good"}
            hint={gaps.length ? `${formatHours(sum(gaps.map((g) => g.missing)))} missing` : "All caught up"}
          />
        </div>

        {gaps.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-300">
            <span className="font-semibold">Fill your timesheet:</span>
            {gaps.slice(0, 12).map((g) => (
              <button key={g.date} className="chip num border-amber-500/30 text-amber-300 hover:text-amber-100" onClick={() => setSelected(g.date)}>
                {formatDay(g.date)} · −{formatHours(g.missing)}
              </button>
            ))}
          </div>
        )}

        {q.loading ? (
          <SkeletonRows rows={5} />
        ) : (
          <div className="glass rounded-2xl p-3">
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_84px] gap-2 px-1 pb-2">
              {WEEKDAYS.map((d) => (
                <div key={d} className="label text-center">
                  {d}
                </div>
              ))}
              <div className="label text-center">Week</div>
            </div>
            <div className="space-y-2">
              {weeks.map((week) => (
                <div key={week[0]} className="grid grid-cols-[repeat(7,minmax(0,1fr))_84px] gap-2">
                  {week.map((d) => (
                    <DayCard
                      key={d}
                      date={d}
                      log={days.get(d)}
                      status={dayStatus(d, days.get(d)?.total ?? 0, today, rules)}
                      dimmed={!inPeriod(d)}
                      isToday={d === today}
                      selected={selected === d}
                      tall={mode === "week"}
                      target={rules.dailyTargetHours}
                      onClick={() => setSelected(d)}
                    />
                  ))}
                  <WeekCell total={weekTotal(days, week[0])} target={weeklyTarget} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && <DayBreakdown date={selected} log={days.get(selected)} target={rules.dailyTargetHours} onClose={() => setSelected(null)} />}
    </div>
  );
}

function TargetKpi({ label, logged, target }: { label: string; logged: number; target: number }) {
  const pct = target > 0 ? (logged / target) * 100 : 0;
  const remaining = Math.max(0, target - logged);
  return (
    <Kpi
      label={label}
      value={formatHours(logged)}
      tone={logged >= target ? "good" : undefined}
      hint={remaining > 0 ? `of ${formatHours(target)} · ${formatHours(remaining)} to go` : `of ${formatHours(target)} · target met`}
    >
      <Progress value={pct} tone={logged >= target ? "good" : "accent"} />
    </Kpi>
  );
}

function WeekCell({ total, target }: { total: number; target: number }) {
  const met = total >= target;
  const color = met ? "#34d399" : total > 0 ? "#fbbf24" : "var(--ink-600)";
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--line-soft)] px-1 text-center" title={`${formatHours(total)} of ${formatHours(target)}`}>
      <span className="num text-sm font-semibold" style={{ color }}>
        {formatHours(total)}
      </span>
      <span className="num text-[10px] text-slate-600">/ {formatHours(target)}</span>
      <div className="mt-1 h-1 w-12 overflow-hidden rounded-full bg-[var(--line-soft)]">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (total / target) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function DayCard({
  date,
  log,
  status,
  dimmed,
  isToday,
  selected,
  tall,
  target,
  onClick,
}: {
  date: string;
  log: DayLog | undefined;
  status: DayStatus;
  dimmed: boolean;
  isToday: boolean;
  selected: boolean;
  tall: boolean;
  target: number;
  onClick: () => void;
}) {
  const style = STATUS_STYLE[status];
  const total = log?.total ?? 0;
  return (
    <button
      onClick={onClick}
      title={style.label}
      className={`group relative flex flex-col rounded-xl border p-2 text-left transition-all hover:-translate-y-px ${
        tall ? "min-h-56" : "min-h-24"
      } ${selected ? "neon-ring" : ""} ${dimmed ? "opacity-35" : ""}`}
      style={{
        borderColor: selected ? "var(--acc-500)" : "var(--line-soft)",
        background: total > 0 ? "var(--panel-2)" : "transparent",
        boxShadow: !selected && style.ring !== "transparent" ? `inset 0 -2px 0 ${style.ring}` : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <span className={`num text-[11px] ${isToday ? "rounded-md bg-[var(--acc-500)] px-1.5 font-bold text-[#021014]" : "text-slate-500"}`}>
          {Number(date.slice(8))}
        </span>
        {status === "empty" || status === "short" ? (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.text, boxShadow: `0 0 8px ${style.text}` }} />
        ) : null}
      </div>
      {total > 0 && (
        <>
          <span className="num mt-auto text-lg font-semibold leading-none" style={{ color: style.text }}>
            {formatHours(total)}
          </span>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--line-soft)]">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, (total / target) * 100)}%`, background: style.text }} />
          </div>
        </>
      )}
      {tall && log && (
        <div className="mt-2 space-y-1">
          {log.entries.slice(0, 6).map((e) => (
            <div key={e.id} className="truncate text-[10px] text-slate-400">
              <span className="num text-slate-300">{formatHours(e.spent)}</span> {e.entity_name}
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

function DayBreakdown({ date, log, target, onClose }: { date: string; log: DayLog | undefined; target: number; onClose: () => void }) {
  const entries = log?.entries ?? [];
  const projects = byProject(entries);
  return (
    <aside className="glass animate-rise sticky top-0 h-fit w-80 shrink-0 rounded-2xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="label">Breakdown</div>
          <h2 className="mt-1 text-base font-semibold text-slate-100">{formatDay(date)}</h2>
        </div>
        <button className="text-xs text-slate-500 hover:text-slate-300" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="num neon-text text-3xl font-bold">{formatHours(log?.total ?? 0)}</span>
        <span className="text-xs text-slate-500">of {formatHours(target)}</span>
      </div>
      <div className="mt-2">
        <Progress value={((log?.total ?? 0) / target) * 100} tone={(log?.total ?? 0) >= target ? "good" : "accent"} />
      </div>

      {projects.length > 1 && (
        <div className="mt-4 space-y-1.5">
          {projects.map((p) => (
            <div key={p.name} className="flex justify-between text-[11px] text-slate-400">
              <span className="truncate">{p.name}</span>
              <span className="num">{formatHours(p.hours)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center text-xs text-slate-500">
            <IconClock size={24} className="mb-2 text-slate-600" />
            Nothing logged this day.
            <span className="mt-1 text-slate-600">Open any item and use “Log time”.</span>
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="rounded-xl border border-[var(--line-soft)] bg-[var(--panel-2)] p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[13px] leading-snug text-slate-200">{e.entity_name || "Untitled"}</span>
                <span className="num shrink-0 text-sm font-semibold text-sky-300">{formatHours(e.spent)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span className="truncate">
                  {e.entity_type} {e.entity_id !== null && <TpId id={e.entity_id} />} · {e.project_name || "No project"}
                </span>
                {e.entity_id !== null && (
                  <button onClick={() => void openInTp(e.entity_id!)} title="Open in TargetProcess" className="hover:text-slate-200">
                    <IconExternal size={12} />
                  </button>
                )}
              </div>
              {e.description && <p className="mt-1.5 text-[11px] text-slate-400">{e.description}</p>}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
