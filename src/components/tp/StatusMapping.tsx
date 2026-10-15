import type { TpSettings } from "../../types";
import { STATUS_CONFIG } from "../tray/trayConfig";

interface StatusMappingProps {
  value: TpSettings;
  onChange: (patch: Partial<TpSettings>) => void;
}

/**
 * Board status → TargetProcess workflow state, laid out as the same five
 * statuses the kanban board uses, so "what does in_progress mean here" has an
 * obvious answer: it's this row, matching that column.
 *
 * Open and waiting are shown too, disabled, so nothing looks silently
 * skipped — the board flow is visible in full even though those two have no
 * TargetProcess counterpart (a new entity already starts in its initial state).
 */
export function StatusMapping({ value, onChange }: StatusMappingProps) {
  return (
    <div>
      <p className="mb-2.5 text-[10px] leading-relaxed text-slate-500">
        When a task reaches a status below, the matching TargetProcess entity is moved to
        the workflow state you type here — <span className="text-slate-400">the exact name
        your TargetProcess workflow uses</span>, not the TaskBoard status itself. Filled in by
        default for the common case; clear a field to stop pushing that transition.
      </p>
      <div className="space-y-1.5">
        <Row
          dot={STATUS_CONFIG.open.dot}
          label={STATUS_CONFIG.open.label}
          disabledHint="starts here automatically"
        />
        <Row
          dot={STATUS_CONFIG.waiting.dot}
          label={STATUS_CONFIG.waiting.label}
          disabledHint="no TargetProcess equivalent"
        />
        <Row
          dot={STATUS_CONFIG.in_progress.dot}
          label={STATUS_CONFIG.in_progress.label}
          value={value.in_progress_state_name}
          onChange={(v) => onChange({ in_progress_state_name: v })}
        />
        <Row
          dot={STATUS_CONFIG.review.dot}
          label={STATUS_CONFIG.review.label}
          value={value.review_state_name}
          onChange={(v) => onChange({ review_state_name: v })}
        />
        <Row
          dot={STATUS_CONFIG.done.dot}
          label={STATUS_CONFIG.done.label}
          value={value.done_state_name}
          onChange={(v) => onChange({ done_state_name: v })}
          required
        />
      </div>
    </div>
  );
}

interface RowProps {
  dot: string;
  label: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  /** Present instead of an input for statuses that can't be synced. */
  disabledHint?: string;
}

function Row({ dot, label, value, onChange, required, disabledHint }: RowProps) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="w-20 shrink-0 text-xs text-slate-300">{label}</span>
      <span className="shrink-0 text-slate-600" aria-hidden>
        →
      </span>
      {disabledHint ? (
        <span className="text-[11px] italic text-slate-700">{disabledHint}</span>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={required ? "required" : "leave blank to skip"}
          className="flex-1 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1 text-xs text-slate-200 outline-none placeholder:text-slate-700 focus:border-sky-600"
        />
      )}
    </div>
  );
}
