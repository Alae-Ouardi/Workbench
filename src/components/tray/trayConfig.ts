import type { Priority, Status } from "../../types";

export const STATUS_CONFIG: Record<Status, { dot: string; label: string; bg: string }> = {
  open: { dot: "bg-slate-400", label: "Open", bg: "bg-slate-400/10 text-slate-400" },
  waiting: { dot: "bg-yellow-500", label: "Waiting", bg: "bg-yellow-500/10 text-yellow-500" },
  in_progress: {
    dot: "bg-violet-500",
    label: "In Progress",
    bg: "bg-violet-500/10 text-violet-400",
  },
  review: { dot: "bg-sky-400", label: "Review", bg: "bg-sky-400/10 text-sky-400" },
  done: { dot: "bg-emerald-500", label: "Done", bg: "bg-emerald-500/10 text-emerald-400" },
};

export const PRIORITY_CONFIG: Record<Priority, { color: string; label: string }> = {
  low: { color: "text-slate-500", label: "Low" },
  normal: { color: "text-sky-400", label: "Normal" },
  high: { color: "text-amber-400", label: "High" },
  urgent: { color: "text-red-400", label: "Urgent" },
};

export const STATUSES: Status[] = ["open", "waiting", "in_progress", "review", "done"];
export const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

/**
 * Reading order in the tray: what is blocked, then what is ready, then what is
 * moving, then what is finished — rather than the board's column order.
 */
export const STATUS_ORDER: Record<Status, number> = {
  waiting: 0,
  open: 1,
  in_progress: 2,
  review: 3,
  done: 4,
};

/** Order the status filter tabs are shown in. */
export const FILTER_ORDER: Status[] = ["waiting", "open", "in_progress", "review", "done"];
