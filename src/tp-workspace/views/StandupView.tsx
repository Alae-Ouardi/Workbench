import { useMemo, useState } from "react";
import { copyText } from "../../shared/clipboard";
import { IconCheck, IconCopy } from "../components/icons";
import { ErrorBanner, SkeletonRows, TpId, TypeBadge, ViewHeader } from "../components/ui";
import { useTpwQuery } from "../hooks/useTpwQuery";
import { addDays, formatDay, previousWorkingDay } from "../logic/dates";
import { formatHours } from "../logic/duration";
import { buildStandup, doneByDay, standupText, type DayLog, type StandupLine } from "../logic/standup";
import { useLocalState, usePrefs } from "../prefs";
import { useWorkspace } from "../WorkspaceContext";
import type { TpTimeEntry, TpWorkItem } from "../types";

type Preset = "today" | "yesterday" | "7d" | "14d" | "30d";
type Range = { preset: Preset } | { from: string; to: string };

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "14d", label: "14 days" },
  { id: "30d", label: "30 days" },
];

function resolveRange(range: Range, today: string): { from: string; to: string } {
  if (!("preset" in range)) return range.from <= range.to ? range : { from: range.to, to: range.from };
  switch (range.preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    default:
      return { from: addDays(today, -13), to: today };
  }
}

function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatDay(date);
}

type Tab = "standup" | "history";

export function StandupView() {
  const { today, connection, setOpenItem } = useWorkspace();
  const { prefs } = usePrefs();
  const [tab, setTab] = useLocalState<Tab>("tpw.standup.tab", "standup");
  const [range, setRange] = useLocalState<Range>("tpw.standup.range", { preset: "14d" });
  const { from, to } = resolveRange(range, today);
  const yesterday = previousWorkingDay(today, prefs.working_days);
  const ready = connection === "ready";

  const yesterdayQ = useTpwQuery<TpTimeEntry[]>({ kind: "times", from: yesterday, to: yesterday });
  const closedQ = useTpwQuery<TpWorkItem[]>(ready ? { kind: "my_closed", since: yesterday } : null);
  const workQ = useTpwQuery<TpWorkItem[]>(ready ? { kind: "my_work" } : null);
  const historyQ = useTpwQuery<TpTimeEntry[]>(tab === "history" ? { kind: "times", from, to } : null);
  const [copied, setCopied] = useState(false);

  const standup = useMemo(
    () => buildStandup(yesterdayQ.data ?? [], workQ.data ?? [], closedQ.data ?? [], today, prefs.working_days),
    [yesterdayQ.data, workQ.data, closedQ.data, today, prefs.working_days],
  );
  const days = useMemo(() => doneByDay(historyQ.data ?? [], from, to, today), [historyQ.data, from, to, today]);
  const totalHours = days.reduce((s, d) => s + d.hours, 0);
  const text = standupText(standup);
  const byId = useMemo(
    () => new Map([...(closedQ.data ?? []), ...(workQ.data ?? [])].map((i) => [i.id, i])),
    [closedQ.data, workQ.data],
  );
  const queries = [yesterdayQ, closedQ, workQ, historyQ];

  async function copy() {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  const renderLine = (l: StandupLine, i: number) => {
    const item = l.id !== null ? byId.get(l.id) : undefined;
    return (
      <li key={`${l.id}-${i}`} className="flex items-center gap-2 text-[13px]">
        {l.type && <TypeBadge type={l.type} />}
        {l.id !== null && <TpId id={l.id} className="text-[11px] text-slate-500" />}
        {item ? (
          <button className="text-left text-slate-200 hover:text-sky-300" onClick={() => setOpenItem(item)}>
            {l.title}
          </button>
        ) : (
          <span className="text-slate-200">{l.title}</span>
        )}
        <span className="text-[11px] text-slate-500">{l.detail}</span>
      </li>
    );
  };

  const list = (items: StandupLine[], empty: string) => (
    <ul className="space-y-1">
      {items.length === 0 && <li className="text-xs text-slate-500">{empty}</li>}
      {items.map(renderLine)}
    </ul>
  );

  const activePreset = "preset" in range ? range.preset : null;
  const standupLoading = yesterdayQ.loading || closedQ.loading || workQ.loading;

  return (
    <div className="max-w-4xl">
      <ViewHeader
        title="Daily standup"
        subtitle="Yesterday's work and your open stories, tasks and bugs in the current sprint."
        refreshing={queries.some((q) => q.refreshing)}
        fetchedAt={workQ.fetchedAt}
        onRefresh={() => queries.forEach((q) => q.refresh())}
        actions={
          <button className="btn btn-primary" onClick={() => void copy()} title="Yesterday, in progress, to do and blockers">
            {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied ? "Copied" : "Copy summary"}
          </button>
        }
      />
      <ErrorBanner error={yesterdayQ.error ?? closedQ.error ?? workQ.error ?? (tab === "history" ? historyQ.error : null)} />

      <div className="mb-3 inline-flex rounded-lg border border-[var(--line)] p-0.5 text-[11.5px]">
        {(["standup", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 ${tab === t ? "bg-[rgb(34_211_238/0.12)] text-sky-200" : "text-slate-400 hover:text-slate-200"}`}
          >
            {t === "standup" ? "Standup" : "History"}
          </button>
        ))}
      </div>

      {tab === "standup" ? (
        standupLoading && !workQ.data ? (
          <SkeletonRows rows={4} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <Card
              title={`Yesterday · ${formatDay(standup.yesterdayDate)}`}
              aside={formatHours(standup.yesterdayHours)}
              accent="#a78bfa"
            >
              {list(standup.yesterday, "Nothing closed or logged")}
            </Card>
            <Card title="In progress" aside={String(standup.inProgress.length)} accent="#22d3ee">
              {list(standup.inProgress, "Nothing in progress")}
            </Card>
            <Card title="To do this sprint" aside={String(standup.todo.length)} accent="#34d399">
              {list(standup.todo, "Nothing left to start")}
            </Card>
            <Card title="Blockers" aside={String(standup.blockers.length)} accent="#fb7185">
              {list(standup.blockers, "None — clear runway")}
            </Card>
          </div>
        )
      ) : (
        <>
          <div className="glass mb-3 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => setRange({ preset: p.id })}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] ${
                  activePreset === p.id
                    ? "border-[rgb(34_211_238/0.4)] bg-[rgb(34_211_238/0.12)] text-sky-200"
                    : "border-[var(--line)] text-slate-400 hover:text-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[var(--line)]" />
            <label className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
              From
              <input
                type="date"
                className="input py-1 text-xs"
                value={from}
                max={today}
                onChange={(e) => e.target.value && setRange({ from: e.target.value, to })}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[11.5px] text-slate-500">
              to
              <input
                type="date"
                className="input py-1 text-xs"
                value={to}
                max={today}
                onChange={(e) => e.target.value && setRange({ from, to: e.target.value })}
              />
            </label>
            <span className="num ml-auto text-[11px] text-slate-500">
              {formatHours(totalHours)} over {days.filter((d) => d.hours > 0).length} days
            </span>
          </div>

          {historyQ.loading ? (
            <SkeletonRows rows={4} />
          ) : days.length === 0 ? (
            <p className="glass rounded-2xl px-4 py-10 text-center text-xs text-slate-500">
              No time logged between {formatDay(from)} and {formatDay(to)}.
            </p>
          ) : (
            <ol className="relative ml-1 space-y-3 border-l border-[var(--line)] pl-5">
              {days.map((d) => (
                <DayCard key={d.date} day={d} label={dayLabel(d.date, today)} target={prefs.daily_target_hours} isToday={d.date === today}>
                  {list(d.lines, "Nothing logged yet today")}
                </DayCard>
              ))}
            </ol>
          )}
        </>
      )}

      {tab === "standup" && (
        <details className="glass mt-4 rounded-2xl p-4">
          <summary className="cursor-pointer text-xs text-slate-500">Plain-text summary preview</summary>
          <pre className="num mt-3 whitespace-pre-wrap text-xs text-slate-300">{text}</pre>
        </details>
      )}
    </div>
  );
}

function Card({ title, aside, accent, children }: { title: string; aside?: string; accent: string; children: React.ReactNode }) {
  return (
    <section className="glass animate-rise relative overflow-hidden rounded-2xl p-4">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent, boxShadow: `0 0 16px ${accent}` }} />
      <div className="mb-2 flex items-center pl-2">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {aside && <span className="num ml-auto text-[11px] text-slate-500">{aside}</span>}
      </div>
      <div className="pl-2">{children}</div>
    </section>
  );
}

function DayCard({
  day,
  label,
  target,
  isToday,
  children,
}: {
  day: DayLog;
  label: string;
  target: number;
  isToday: boolean;
  children: React.ReactNode;
}) {
  const pct = target > 0 ? Math.min(100, (day.hours / target) * 100) : 0;
  const color = isToday ? "#22d3ee" : "#a78bfa";
  return (
    <li className="relative">
      <span
        className="absolute top-5 -left-[26px] h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 10px ${color}` }}
      />
      <section className="glass animate-rise rounded-2xl p-4">
        <div className="mb-2 flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
          {label !== formatDay(day.date) && <span className="num text-[11px] text-slate-500">{formatDay(day.date)}</span>}
          <span className="num ml-auto text-[12px] font-semibold" style={{ color }}>
            {formatHours(day.hours)}
          </span>
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--line)]">
            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
          </span>
        </div>
        {children}
      </section>
    </li>
  );
}
