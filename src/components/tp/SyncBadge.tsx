import type { TpSyncState } from "../../types";

const CONFIG: Record<
  Exclude<TpSyncState, "none">,
  { dot: string; label: string; ring: string }
> = {
  pending: {
    dot: "bg-amber-400",
    ring: "ring-amber-400/30",
    label: "Waiting to reach TargetProcess",
  },
  synced: {
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    label: "In sync with TargetProcess",
  },
  error: {
    dot: "bg-red-500",
    ring: "ring-red-500/30",
    label: "TargetProcess sync failed",
  },
};

interface SyncBadgeProps {
  state: TpSyncState;
  /** The last error, shown in the tooltip when `state` is "error". */
  error?: string;
  /** Show the state name next to the dot. */
  withLabel?: boolean;
}

/**
 * A one-glance indicator of whether a task has reached TargetProcess.
 * Renders nothing for unlinked tasks, so unlinked projects look untouched.
 */
export function SyncBadge({ state, error, withLabel = false }: SyncBadgeProps) {
  if (state === "none") return null;
  const config = CONFIG[state];
  const title = error ? `${config.label}: ${error}` : config.label;

  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1"
      aria-label={title}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ring-2 ${config.dot} ${config.ring} ${
          state === "pending" ? "animate-pulse" : ""
        }`}
      />
      {withLabel && (
        <span
          className={`text-[10px] ${
            state === "error"
              ? "text-red-400"
              : state === "pending"
                ? "text-amber-400"
                : "text-emerald-500"
          }`}
        >
          {state === "error" ? "sync failed" : state}
        </span>
      )}
    </span>
  );
}
