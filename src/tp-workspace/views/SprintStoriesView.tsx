import { Fragment, useMemo, useState } from "react";
import { IconChevronRight, IconStories } from "../components/icons";
import { Avatars, Empty, ErrorBanner, Progress, ProjectTag, SkeletonRows, StatePill, TypeBadge, ViewHeader, TpId } from "../components/ui";
import { useTpwQuery } from "../hooks/useTpwQuery";
import { formatHours } from "../logic/duration";
import { applyFilters, burndownUnits, childrenByStory, round1, sum } from "../logic/work";
import { useWorkspace } from "../WorkspaceContext";
import type { TpWorkItem } from "../types";

type SortKey = "state" | "progress" | "effort" | "name";

function progressOf(item: TpWorkItem): number {
  if (item.state.is_final) return 100;
  return item.effort > 0 ? (item.effort_completed / item.effort) * 100 : 0;
}

export function SprintStoriesView() {
  const { sprint, filters, setOpenItem } = useWorkspace();
  const q = useTpwQuery<TpWorkItem[]>(sprint ? { kind: "sprint_items", sprint_id: sprint.id } : null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState<SortKey>("state");

  const all = q.data ?? [];
  const children = useMemo(() => childrenByStory(all), [all]);
  const rows = useMemo(() => {
    // A story stays visible when one of its tasks matches the filter.
    const matching = new Set(applyFilters(all, filters).map((i) => i.id));
    const units = burndownUnits(all).filter(
      (u) => matching.has(u.id) || (children.get(u.id) ?? []).some((c) => matching.has(c.id)),
    );
    const by: Record<SortKey, (a: TpWorkItem, b: TpWorkItem) => number> = {
      state: (a, b) =>
        Number(a.state.is_final) - Number(b.state.is_final) || a.state.numeric_priority - b.state.numeric_priority,
      progress: (a, b) => progressOf(a) - progressOf(b),
      effort: (a, b) => b.effort - a.effort,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...units].sort(by[sort]);
  }, [all, filters, children, sort]);

  function toggle(id: number) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  const totals = {
    effort: round1(sum(rows.map((r) => r.effort))),
    spent: sum(rows.map((r) => r.time_spent)),
    remain: sum(rows.map((r) => r.time_remain)),
  };

  return (
    <div>
      <ViewHeader
        title="Sprint user stories"
        subtitle={
          sprint ? (
            <>
              {sprint.name} · <span className="num">{rows.length}</span> stories ·{" "}
              <span className="num">{totals.effort}</span>pt · <span className="num">{formatHours(totals.spent)}</span> spent ·{" "}
              <span className="num">{formatHours(totals.remain)}</span> left
            </>
          ) : undefined
        }
        actions={
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="Sort">
            <option value="state">Sort: workflow</option>
            <option value="progress">Sort: least progress</option>
            <option value="effort">Sort: biggest</option>
            <option value="name">Sort: name</option>
          </select>
        }
        refreshing={q.refreshing}
        fetchedAt={q.fetchedAt}
        onRefresh={q.refresh}
      />
      <ErrorBanner error={q.error} />

      {q.loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <Empty icon={<IconStories size={28} />} title="No user stories match" hint="Try another sprint or clear the filters." />
      ) : (
        <div className="glass overflow-hidden rounded-2xl">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--line)] text-slate-500">
                <th className="w-8" />
                <th className="py-2.5 pr-3 font-medium">Story</th>
                <th className="px-3 font-medium">Project</th>
                <th className="px-3 font-medium">State</th>
                <th className="px-3 font-medium">Owner</th>
                <th className="w-40 px-3 font-medium">Progress</th>
                <th className="px-3 text-right font-medium">Spent / left</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((story) => {
                const kids = children.get(story.id) ?? [];
                const open = expanded.has(story.id);
                return (
                  <Fragment key={story.id}>
                    <tr className="group border-b border-[var(--line-soft)] hover:bg-[var(--line-soft)]">
                      <td className="pl-2">
                        {kids.length > 0 && (
                          <button
                            onClick={() => toggle(story.id)}
                            className="rounded p-1 text-slate-500 hover:text-slate-200"
                            aria-label={open ? "Collapse" : "Expand"}
                          >
                            <IconChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
                          </button>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        <button className="flex items-center gap-2 text-left" onClick={() => setOpenItem(story)}>
                          <TypeBadge type={story.entity_type} />
                          <TpId id={story.id} className="text-slate-500" />
                          <span className="text-[13px] text-slate-200 group-hover:text-slate-50">{story.name}</span>
                          {kids.length > 0 && <span className="num chip">{kids.length}</span>}
                        </button>
                      </td>
                      <td className="px-3">
                        <ProjectTag projectId={story.project_id} name={story.project_name} />
                      </td>
                      <td className="px-3">
                        <StatePill name={story.state.name} isFinal={story.state.is_final} />
                      </td>
                      <td className="px-3">
                        <Avatars people={story.assigned} />
                      </td>
                      <td className="px-3">
                        <div className="flex items-center gap-2">
                          <Progress value={progressOf(story)} tone={story.state.is_final ? "good" : "accent"} />
                          <span className="num w-9 text-right text-slate-500">{Math.round(progressOf(story))}%</span>
                        </div>
                      </td>
                      <td className="num px-3 text-right text-slate-400">
                        {formatHours(story.time_spent)} / {formatHours(story.time_remain)}
                      </td>
                    </tr>
                    {open &&
                      kids.map((kid) => (
                        <tr key={kid.id} className="border-b border-[var(--line-soft)]">
                          <td />
                          <td className="py-2 pl-8 pr-3">
                            <button className="flex items-center gap-2 text-left" onClick={() => setOpenItem(kid)}>
                              <TypeBadge type={kid.entity_type} />
                              <TpId id={kid.id} className="text-slate-500" />
                              <span className="text-slate-300 hover:text-slate-50">{kid.name}</span>
                            </button>
                          </td>
                          <td />
                          <td className="px-3">
                            <StatePill name={kid.state.name} isFinal={kid.state.is_final} />
                          </td>
                          <td className="px-3">
                            <Avatars people={kid.assigned} />
                          </td>
                          <td />
                          <td className="num px-3 text-right text-slate-500">
                            {formatHours(kid.time_spent)} / {formatHours(kid.time_remain)}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
