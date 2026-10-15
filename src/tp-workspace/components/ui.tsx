import type { KeyboardEvent, MouseEvent } from "react";
import { openInTp } from "../api";
export { Empty, ErrorBanner, Kpi, relativeTime, SkeletonRows, ViewHeader } from "../../shared/ui";
import { useWorkspace } from "../WorkspaceContext";
import { daysBetween } from "../logic/dates";
import { formatHours } from "../logic/duration";
import { isBlocked } from "../logic/standup";
import { overdueInfo } from "../logic/work";
import type { TpWorkItem } from "../types";

/**
 * A TargetProcess id that opens the item in TP. A span, not a button, so it
 * can sit inside clickable cards; it stops the click from opening the card.
 */
export function TpId({ id, className = "" }: { id: number; className?: string }) {
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    openInTp(id).catch(() => undefined);
  };
  return (
    <span
      role="link"
      tabIndex={0}
      title={`Open #${id} in TargetProcess`}
      onClick={open}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(e)}
      className={`num cursor-pointer rounded underline-offset-2 hover:text-sky-300 hover:underline focus-visible:text-sky-300 focus-visible:underline focus-visible:outline-none ${className}`}
    >
      #{id}
    </span>
  );
}

const TYPE_STYLE: Record<string, { label: string; color: string }> = {
  UserStory: { label: "US", color: "#22d3ee" },
  Task: { label: "T", color: "#a78bfa" },
  Bug: { label: "B", color: "#fb7185" },
};

export function TypeBadge({ type }: { type: string }) {
  const style = TYPE_STYLE[type] ?? { label: "?", color: "var(--ink-500)" };
  return (
    <span
      title={type}
      className="num inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-[10px] font-bold"
      style={{ color: style.color, background: `${style.color}1f`, boxShadow: `inset 0 0 0 1px ${style.color}40` }}
    >
      {style.label}
    </span>
  );
}

export function ProjectTag({ projectId, name }: { projectId: number | null; name: string }) {
  const { projectColor } = useWorkspace();
  if (!name) return null;
  const color = projectColor(projectId);
  return (
    <span className="chip max-w-40" title={name}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function StatePill({ name, isFinal }: { name: string; isFinal: boolean }) {
  return (
    <span
      className={`chip ${isFinal ? "border-emerald-500/30 text-emerald-400" : ""}`}
      style={isFinal ? { background: "rgb(16 185 129 / 0.1)" } : undefined}
    >
      {name || "—"}
    </span>
  );
}

export function Avatars({ people }: { people: { id: number; name: string }[] }) {
  if (!people.length) return <span className="text-[11px] text-slate-600">Unassigned</span>;
  return (
    <div className="flex -space-x-1.5">
      {people.slice(0, 3).map((p) => (
        <span
          key={p.id}
          title={p.name}
          className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--panel-solid)] text-[9px] font-bold text-slate-100"
          style={{ background: `hsl(${(p.id * 47) % 360} 55% 38%)` }}
        >
          {initials(p.name)}
        </span>
      ))}
      {people.length > 3 && <span className="pl-2 text-[10px] text-slate-500">+{people.length - 3}</span>}
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "good" | "warn" }) {
  const pct = Math.max(0, Math.min(100, value));
  const bg =
    tone === "good"
      ? "linear-gradient(90deg,#10b981,#34d399)"
      : tone === "warn"
        ? "linear-gradient(90deg,#f59e0b,#fb7185)"
        : "linear-gradient(90deg,var(--acc-500),#a78bfa)";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line-soft)]">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: bg }} />
    </div>
  );
}

/**
 * Card for a work item; click opens the detail drawer. User stories are the
 * sprint's units of delivery, so they get a heavier, tinted card with a
 * progress bar; tasks and bugs are slimmer, outlined and indented beneath.
 */
export function ItemCard({
  item,
  showState = false,
  childCount,
  taskStyle = "compact",
}: {
  item: TpWorkItem;
  showState?: boolean;
  /** Tasks/bugs under a story, when the caller knows it. */
  childCount?: number;
  /**
   * `compact`: slim, indented — for tasks shown beneath their stories.
   * `full`: a card of its own — for boards that show only tasks and bugs.
   */
  taskStyle?: "compact" | "full";
}) {
  if (item.entity_type === "UserStory") {
    return <StoryCard item={item} showState={showState} childCount={childCount} />;
  }
  return taskStyle === "full" ? <TaskCard item={item} showState={showState} /> : <WorkCard item={item} showState={showState} />;
}

/** Full-size task/bug card, tinted by type so it never reads like a story. */
function TaskCard({ item, showState }: { item: TpWorkItem; showState: boolean }) {
  const { setOpenItem, projectColor } = useWorkspace();
  const bug = item.entity_type === "Bug";
  const accent = bug ? "#fb7185" : "#a78bfa";
  const tint = bug ? "251 113 133" : "167 139 250";
  const flag = useFlag(item);
  const total = item.time_spent + item.time_remain;
  const progress = item.state.is_final ? 100 : total > 0 ? (item.time_spent / total) * 100 : 0;
  const color = projectColor(item.project_id);
  return (
    <button
      onClick={() => setOpenItem(item)}
      className="group relative w-full overflow-hidden rounded-xl border p-3.5 text-left transition-all hover:-translate-y-px"
      style={{
        borderColor: `rgb(${tint} / 0.35)`,
        background: `linear-gradient(160deg, rgb(${tint} / 0.12), var(--panel-2) 55%)`,
        boxShadow: "0 0 0 0 transparent",
      }}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent, boxShadow: `0 0 10px ${accent}` }} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <TypeBadge type={item.entity_type} />
          <span className="truncate whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>
            {bug ? "Bug" : "Task"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <Flag flag={flag} />
          {item.time_remain > 0 && <span className="chip num">{formatHours(item.time_remain)} left</span>}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-[13px] font-semibold leading-snug text-slate-100 group-hover:text-slate-50">{item.name}</p>
      {item.user_story_name && (
        <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
          <span className="num shrink-0 rounded bg-[rgb(34_211_238/0.15)] px-1 text-[9px] font-bold text-sky-300">US</span>
          <span className="truncate">{item.user_story_name}</span>
        </p>
      )}
      <div className="mt-3">
        <Progress value={progress} tone={item.state.is_final ? "good" : "accent"} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          <TpId id={item.id} className="text-[11px] text-slate-400" />
          {showState && <StatePill name={item.state.name} isFinal={item.state.is_final} />}
          {item.time_spent > 0 && <span className="num text-[11px] text-slate-500">{formatHours(item.time_spent)} spent</span>}
        </div>
        <Avatars people={item.assigned} />
      </div>
    </button>
  );
}

/** Attention flag for an open item: blocked, late, or due within two days. */
function useFlag(item: TpWorkItem): { text: string; color: string } | null {
  const { today } = useWorkspace();
  if (item.state.is_final) return null;
  if (isBlocked(item)) return { text: "Blocked", color: "#fb7185" };
  const late = overdueInfo(item, today);
  if (late) return { text: `${late.daysLate}d late`, color: "#fb7185" };
  if (item.planned_end_date) {
    const dueIn = daysBetween(today, item.planned_end_date);
    if (dueIn <= 2) return { text: dueIn === 0 ? "Due today" : `Due in ${dueIn}d`, color: "#fbbf24" };
  }
  return null;
}

function Flag({ flag }: { flag: { text: string; color: string } | null }) {
  if (!flag) return null;
  return (
    <span className="chip num" style={{ color: flag.color, borderColor: `${flag.color}55`, background: `${flag.color}14` }}>
      {flag.text}
    </span>
  );
}

function StoryCard({ item, showState, childCount }: { item: TpWorkItem; showState: boolean; childCount?: number }) {
  const { setOpenItem, projectColor } = useWorkspace();
  const color = projectColor(item.project_id);
  const progress = item.state.is_final ? 100 : item.effort > 0 ? (item.effort_completed / item.effort) * 100 : 0;
  const flag = useFlag(item);
  return (
    <button
      onClick={() => setOpenItem(item)}
      className="group relative w-full overflow-hidden rounded-xl border p-3.5 text-left transition-all hover:-translate-y-px hover:shadow-[0_10px_34px_-12px_var(--glow)]"
      style={{
        borderColor: "rgb(34 211 238 / 0.35)",
        background: "linear-gradient(160deg, rgb(34 211 238 / 0.13), var(--panel-2) 55%)",
      }}
    >
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: "linear-gradient(90deg,#22d3ee,#a78bfa)" }} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <TypeBadge type="UserStory" />
          <span className="truncate whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300">User story</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <Flag flag={flag} />
          {item.effort > 0 && <span className="num rounded-md bg-[rgb(34_211_238/0.15)] px-1.5 py-0.5 text-[11px] font-bold text-sky-200">{item.effort} pt</span>}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-[14px] font-semibold leading-snug text-slate-100 group-hover:text-slate-50">{item.name}</p>
      <div className="mt-3">
        <Progress value={progress} tone={item.state.is_final ? "good" : "accent"} />
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          <TpId id={item.id} className="text-[11px] text-slate-400" />
          {showState && <StatePill name={item.state.name} isFinal={item.state.is_final} />}
          {childCount !== undefined && childCount > 0 && <span className="num chip">{childCount} tasks</span>}
        </div>
        <Avatars people={item.assigned} />
      </div>
    </button>
  );
}

function WorkCard({ item, showState }: { item: TpWorkItem; showState: boolean }) {
  const { setOpenItem } = useWorkspace();
  const accent = item.entity_type === "Bug" ? "#fb7185" : "#a78bfa";
  const flag = useFlag(item);
  return (
    <button
      onClick={() => setOpenItem(item)}
      className="group relative ml-3 w-[calc(100%-0.75rem)] overflow-hidden rounded-lg border border-dashed px-2.5 py-2 text-left transition-all hover:border-solid hover:bg-[var(--panel-2)]"
      style={{ borderColor: `${accent}55`, background: "transparent" }}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent }} />
      <div className="flex items-start gap-2 pl-1">
        <TypeBadge type={item.entity_type} />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[12px] leading-snug text-slate-300 group-hover:text-slate-100">{item.name}</p>
          {item.user_story_name && (
            <p className="mt-0.5 truncate text-[10px] text-slate-500">↳ {item.user_story_name}</p>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 pl-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <TpId id={item.id} className="text-[10px] text-slate-500" />
          {showState && <StatePill name={item.state.name} isFinal={item.state.is_final} />}
          {item.time_remain > 0 && <span className="num text-[10px] text-slate-500">{formatHours(item.time_remain)} left</span>}
          <Flag flag={flag} />
        </div>
        <Avatars people={item.assigned} />
      </div>
    </button>
  );
}
