import { useMemo } from "react";
import { BurndownChart } from "../components/BurndownChart";
import { StateBoard } from "../components/StateBoard";
import { IconDashboard } from "../components/icons";
import { Empty, ErrorBanner, Kpi, Progress, SkeletonRows, ViewHeader } from "../components/ui";
import { useTpwQuery } from "../hooks/useTpwQuery";
import { alignColumns, sortColumns } from "../logic/board";
import { computeBurndown } from "../logic/burndown";
import { daysBetween, formatDay } from "../logic/dates";
import { applyFilters, childrenByStory, groupByState, round1, sprintKpis } from "../logic/work";
import { useLocalState } from "../prefs";
import { useWorkspace } from "../WorkspaceContext";
import type { TpWorkItem } from "../types";

export function DashboardView() {
  const { sprint, filters, today } = useWorkspace();
  const q = useTpwQuery<TpWorkItem[]>(sprint ? { kind: "sprint_items", sprint_id: sprint.id } : null);
  const items = useMemo(() => applyFilters(q.data ?? [], filters), [q.data, filters]);
  // The board shows one level at a time: user stories, or the tasks and bugs
  // under them. KPIs and burndown always use the whole sprint.
  const [boardLevel, setBoardLevel] = useLocalState<"stories" | "tasks" | "all">("tpw.dashboard.level", "stories");
  const columns = useMemo(
    () =>
      sortColumns(
        groupByState(
          items.filter((i) =>
            boardLevel === "all" ? true : boardLevel === "stories" ? i.entity_type === "UserStory" : i.entity_type !== "UserStory",
          ),
        ),
        today,
      ),
    [items, boardLevel, today],
  );
  // Every state of the sprint stays on the board, even when filters empty it.
  const boardColumns = useMemo(() => alignColumns(columns, groupByState(q.data ?? [])), [columns, q.data]);
  const levelCounts = {
    stories: items.filter((i) => i.entity_type === "UserStory").length,
    tasks: items.filter((i) => i.entity_type !== "UserStory").length,
  };
  const children = useMemo(() => childrenByStory(q.data ?? []), [q.data]);
  const [showBurndown, setShowBurndown] = useLocalState("tpw.dashboard.burndown", true);
  const kpis = useMemo(() => sprintKpis(items), [items]);
  const burndown = useMemo(() => (sprint ? computeBurndown(items, sprint, today) : null), [items, sprint, today]);

  if (!sprint) {
    return <Empty icon={<IconDashboard size={28} />} title="No sprint found" hint="No team iteration ended in the last few months. Check your project filter or TargetProcess access." />;
  }

  const daysLeft = sprint.end_date ? Math.max(0, daysBetween(today, sprint.end_date)) : null;
  const sprintLength = sprint.start_date && sprint.end_date ? daysBetween(sprint.start_date, sprint.end_date) + 1 : null;
  const elapsedPct = sprintLength && daysLeft !== null ? ((sprintLength - daysLeft) / sprintLength) * 100 : 0;
  // Behind when the share of work done trails the share of time used.
  const behind = kpis.progress + 10 < elapsedPct;

  return (
    <div>
      <ViewHeader
        title={sprint.name}
        subtitle={
          <>
            {sprint.team_name && <span>{sprint.team_name} · </span>}
            {sprint.start_date && sprint.end_date
              ? `${formatDay(sprint.start_date)} → ${formatDay(sprint.end_date)}`
              : "Dates not set"}
          </>
        }
        refreshing={q.refreshing}
        fetchedAt={q.fetchedAt}
        onRefresh={q.refresh}
        actions={
          <button
            className={`btn ${showBurndown ? "border-[var(--acc-500)] text-sky-300" : ""}`}
            onClick={() => setShowBurndown(!showBurndown)}
            aria-pressed={showBurndown}
            title={showBurndown ? "Hide the burndown chart" : "Show the burndown chart"}
          >
            <span
              className={`relative inline-block h-3.5 w-6 rounded-full transition-colors ${showBurndown ? "bg-[var(--acc-500)]" : "bg-[var(--line-strong)]"}`}
            >
              <span
                className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${showBurndown ? "left-3" : "left-0.5"}`}
              />
            </span>
            Burndown
          </button>
        }
      />
      <ErrorBanner error={q.error} />

      {q.loading ? (
        <SkeletonRows rows={8} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Progress" value={`${kpis.progress}%`} tone={behind ? "warn" : kpis.progress >= 100 ? "good" : undefined} hint={behind ? "Behind the clock" : "On track"}>
              <Progress value={kpis.progress} tone={behind ? "warn" : "accent"} />
            </Kpi>
            <Kpi
              label="Delivered"
              value={
                <>
                  {kpis.done}
                  <span className="text-base text-slate-500">/{kpis.total}</span>
                </>
              }
              hint={kpis.effortTotal > 0 ? `${round1(kpis.effortDone)} of ${round1(kpis.effortTotal)} pt` : "stories & loose bugs"}
            />
            <Kpi
              label="Days left"
              value={daysLeft ?? "—"}
              tone={daysLeft !== null && daysLeft <= 2 && kpis.progress < 100 ? "bad" : undefined}
              hint={sprintLength ? `${Math.round(elapsedPct)}% of sprint elapsed` : undefined}
            >
              <Progress value={elapsedPct} tone="warn" />
            </Kpi>
            <Kpi
              label="Attention"
              value={kpis.bugsOpen}
              tone={kpis.bugsOpen > 0 ? "bad" : "good"}
              hint={`open bugs · ${kpis.unassigned} unassigned`}
            />
          </div>

          {showBurndown && burndown && (
            <section className="glass mt-4 rounded-2xl p-4">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="label">Burndown</h2>
                <span className="text-[11px] text-slate-500">
                  <span className="mr-3 inline-block h-0.5 w-4 bg-[var(--acc-400)] align-middle" />
                  remaining {burndown.unit === "effort" ? "effort" : "items"}
                  <span className="mx-3 inline-block w-4 border-t border-dashed border-slate-500 align-middle" />
                  ideal · rebuilt from finish dates
                </span>
              </div>
              <BurndownChart burndown={burndown} today={today} />
            </section>
          )}

          <section className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="label">Board</h2>
              <div className="flex rounded-lg border border-[var(--line)] p-0.5" role="tablist" aria-label="Board level">
                {(
                  [
                    { id: "stories", label: "User stories", count: levelCounts.stories },
                    { id: "tasks", label: "Tasks & bugs", count: levelCounts.tasks },
                    { id: "all", label: "All", count: levelCounts.stories + levelCounts.tasks },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    role="tab"
                    aria-selected={boardLevel === opt.id}
                    onClick={() => setBoardLevel(opt.id)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors ${
                      boardLevel === opt.id ? "bg-[var(--line)] text-slate-50" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {opt.label}
                    <span className="num text-[10px] text-slate-500">{opt.count}</span>
                  </button>
                ))}
              </div>
            </div>
            {columns.length === 0 ? (
              <Empty
                title={
                  boardLevel === "stories"
                    ? "No user stories match the current filters"
                    : boardLevel === "tasks"
                      ? "No tasks or bugs match the current filters"
                      : "No items match the current filters"
                }
              />
            ) : (
              <StateBoard
                columns={boardColumns}
                childCounts={new Map([...children].map(([id, kids]) => [id, kids.length]))}
                maxHeight="60vh"
                taskStyle={boardLevel === "tasks" ? "full" : "compact"}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
