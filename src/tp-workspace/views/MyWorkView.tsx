import { useMemo } from "react";
import { IconUser } from "../components/icons";
import { StateBoard } from "../components/StateBoard";
import { Empty, ErrorBanner, Kpi, SkeletonRows, ViewHeader } from "../components/ui";
import { useTpwQuery } from "../hooks/useTpwQuery";
import { alignColumns, sortColumns } from "../logic/board";
import { daysBetween } from "../logic/dates";
import { isActive, isBlocked } from "../logic/standup";
import { applyFilters, childrenByStory, groupByState, overdueInfo } from "../logic/work";
import { useWorkspace } from "../WorkspaceContext";
import type { TpWorkItem } from "../types";

export function MyWorkView() {
  const { filters, me, connection, today } = useWorkspace();
  const q = useTpwQuery<TpWorkItem[]>(connection === "ready" ? { kind: "my_work" } : null);
  // The assignee filter is meaningless here; everything is already mine.
  const items = useMemo(() => applyFilters(q.data ?? [], { ...filters, assigneeId: null }), [q.data, filters]);
  const columns = useMemo(
    () => alignColumns(sortColumns(groupByState(items), today), groupByState(q.data ?? [])),
    [items, today, q.data],
  );
  const childCounts = useMemo(
    () => new Map([...childrenByStory(q.data ?? [])].map(([id, kids]) => [id, kids.length])),
    [q.data],
  );

  const counts = {
    stories: items.filter((i) => i.entity_type === "UserStory").length,
    active: items.filter(isActive).length,
    overdue: items.filter((i) => overdueInfo(i, today) !== null).length,
    blocked: items.filter(isBlocked).length,
    dueSoon: items.filter(
      (i) => i.planned_end_date !== null && i.planned_end_date >= today && daysBetween(today, i.planned_end_date) <= 7,
    ).length,
  };

  return (
    <div>
      <ViewHeader
        title="My work"
        subtitle={`${me?.name ?? "You"} · ${items.length} open items (${counts.stories} user stories, ${items.length - counts.stories} tasks & bugs) across every sprint`}
        refreshing={q.refreshing}
        fetchedAt={q.fetchedAt}
        onRefresh={q.refresh}
      />
      <ErrorBanner error={q.error} />
      {q.loading ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <Empty icon={<IconUser size={28} />} title="Nothing assigned to you" hint="Inbox zero. Enjoy it while it lasts." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="In progress" value={counts.active} />
            <Kpi label="Due in 7 days" value={counts.dueSoon} tone={counts.dueSoon ? "warn" : undefined} />
            <Kpi label="Overdue" value={counts.overdue} tone={counts.overdue ? "bad" : "good"} />
            <Kpi label="Blocked" value={counts.blocked} tone={counts.blocked ? "bad" : "good"} />
          </div>
          <StateBoard columns={columns} childCounts={childCounts} />
        </>
      )}
    </div>
  );
}
