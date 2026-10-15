import { useMemo } from "react";
import { IconAlarm } from "../components/icons";
import { Avatars, Empty, ErrorBanner, Kpi, ProjectTag, SkeletonRows, StatePill, TypeBadge, ViewHeader, TpId } from "../components/ui";
import { useTpwQuery } from "../hooks/useTpwQuery";
import { formatDay } from "../logic/dates";
import { applyFilters, overdueList } from "../logic/work";
import { useWorkspace } from "../WorkspaceContext";
import type { TpWorkItem } from "../types";

function severity(days: number): { color: string; label: string } {
  if (days > 14) return { color: "#fb7185", label: "critical" };
  if (days > 5) return { color: "#fbbf24", label: "late" };
  return { color: "#67e8f9", label: "slipping" };
}

export function OverdueView() {
  const { filters, today, setOpenItem, me } = useWorkspace();
  // The server-side query is narrowed by project so a large instance doesn't
  // return every late item in the company; text/assignee filter locally.
  const projectIds = useMemo(() => [...filters.projectIds].sort((a, b) => a - b), [filters.projectIds]);
  const q = useTpwQuery<TpWorkItem[]>({ kind: "overdue", project_ids: projectIds });
  const list = useMemo(() => overdueList(applyFilters(q.data ?? [], filters), today), [q.data, filters, today]);

  const mine = me ? list.filter((o) => o.item.assigned.some((p) => p.id === me.id)).length : 0;
  const critical = list.filter((o) => o.daysLate > 14).length;
  const avg = list.length ? Math.round(list.reduce((a, o) => a + o.daysLate, 0) / list.length) : 0;

  return (
    <div>
      <ViewHeader
        title="Overdue"
        subtitle="Unfinished stories, tasks and bugs past their planned end, or left behind in a sprint that has ended."
        refreshing={q.refreshing}
        fetchedAt={q.fetchedAt}
        onRefresh={q.refresh}
      />
      <ErrorBanner error={q.error} />
      {filters.projectIds.length === 0 && (
        <p className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs text-amber-300/90">
          Showing every project. Pick projects in the filter bar (or set defaults in Settings) to focus this list.
        </p>
      )}

      {q.loading ? (
        <SkeletonRows />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Overdue" value={list.length} tone={list.length ? "bad" : "good"} />
            <Kpi label="Assigned to me" value={mine} tone={mine ? "warn" : "good"} />
            <Kpi label="Critical (>14d)" value={critical} tone={critical ? "bad" : "good"} />
            <Kpi label="Average delay" value={`${avg}d`} />
          </div>
          {list.length === 0 ? (
            <Empty icon={<IconAlarm size={28} />} title="Nothing overdue" hint="Every open item is within its planned dates." />
          ) : (
            <div className="space-y-2">
              {list.map(({ item, daysLate, dueDate, reason }, i) => {
                const sev = severity(daysLate);
                return (
                  <button
                    key={item.id}
                    onClick={() => setOpenItem(item)}
                    className="glass animate-rise flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:border-[var(--line-strong)]"
                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  >
                    <div className="w-16 shrink-0 text-center">
                      <div className="num text-xl font-semibold" style={{ color: sev.color, textShadow: `0 0 18px ${sev.color}66` }}>
                        {daysLate}d
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">{sev.label}</div>
                    </div>
                    <TypeBadge type={item.entity_type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <TpId id={item.id} className="text-[11px] text-slate-500" />
                        <span className="truncate text-[13px] text-slate-200">{item.name}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {reason === "sprint_ended" ? `Sprint ${item.sprint_name} ended` : "Planned end"} {formatDay(dueDate)}
                      </div>
                    </div>
                    <ProjectTag projectId={item.project_id} name={item.project_name} />
                    <StatePill name={item.state.name} isFinal={item.state.is_final} />
                    <Avatars people={item.assigned} />
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
