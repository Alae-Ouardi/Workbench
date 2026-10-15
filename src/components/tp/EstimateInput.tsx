import { formatEstimate } from "../../types";

interface EstimateInputProps {
  /** Effort in points, where 1 point = 1 hour. */
  value: number;
  onChange: (points: number) => void;
  /** Render compactly, for inline use in the tray. */
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Effort estimate in TargetProcess points (1 = 1 hour, 0.5 = 30 min), which is
 * what gets logged as time spent when the task is completed. Stepped by 0.25 so
 * quarter-hour estimates are one click away.
 */
export function EstimateInput({
  value,
  onChange,
  compact = false,
  disabled = false,
}: EstimateInputProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        step={0.25}
        value={value || ""}
        disabled={disabled}
        placeholder="0"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const next = Number.parseFloat(e.target.value);
          onChange(Number.isFinite(next) && next > 0 ? next : 0);
        }}
        className={`rounded border border-[var(--line)] bg-[var(--bg)] text-right text-slate-300 outline-none focus:border-sky-600 disabled:opacity-50 ${
          compact ? "w-14 px-1 py-0.5 text-[11px]" : "w-20 px-2 py-1 text-xs"
        }`}
      />
      <span className={`text-slate-600 ${compact ? "text-[10px]" : "text-xs"}`}>
        pts{value > 0 ? ` · ${formatEstimate(value)}` : ""}
      </span>
    </span>
  );
}

interface EstimateBadgeProps {
  points: number;
  /** Hours already logged to TargetProcess, if any. */
  logged?: number;
}

/** Read-only estimate pill for cards and rows. */
export function EstimateBadge({ points, logged = 0 }: EstimateBadgeProps) {
  if (points <= 0) return null;
  const isLogged = logged > 0;
  return (
    <span
      title={
        isLogged
          ? `${formatEstimate(logged)} logged to TargetProcess`
          : `Estimated ${formatEstimate(points)} of human effort`
      }
      className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[10px] ${
        isLogged
          ? "bg-emerald-950/50 text-emerald-500"
          : "bg-[var(--panel-2)] text-slate-500"
      }`}
    >
      {isLogged && <span aria-hidden>✓</span>}
      {formatEstimate(points)}
    </span>
  );
}
