import { useState } from "react";
import packageJson from "../../../package.json";
import { tpSyncNow } from "../../api";
import { formatEstimate, type Task } from "../../types";

interface TrayFooterProps {
  /** The tasks currently in view, after filtering. */
  visible: Task[];
  /** Every task of the selected project, for the done/total count. */
  all: Task[];
  pendingCount: number;
  failedCount: number;
  onSynced: () => void;
}

/**
 * Where the popover reports on itself: how much is finished, how much effort it
 * adds up to, and whether anything is stuck on its way to TargetProcess.
 */
export function TrayFooter({
  visible,
  all,
  pendingCount,
  failedCount,
  onSynced,
}: TrayFooterProps) {
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const done = all.filter((t) => t.status === "done").length;
  const totalEstimate = all.reduce((sum, t) => sum + t.estimate_points, 0);
  const loggedEstimate = all.reduce((sum, t) => sum + t.tp_time_logged, 0);
  const queued = pendingCount + failedCount;

  async function sync() {
    setSyncing(true);
    setNote(null);
    try {
      const report = await tpSyncNow();
      setNote(report.error ?? null);
      onSynced();
    } catch (e) {
      setNote(String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="shrink-0 border-t border-white/[0.04]">
      {note && (
        <p className="break-words border-b border-white/[0.04] bg-red-500/[0.07] px-4 py-1.5 text-[10px] leading-relaxed text-red-400">
          {note}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 px-4 py-1.5">
        <span className="flex items-center gap-2 text-[10px] text-slate-600">
          <span>
            {done}/{all.length} done
          </span>
          {totalEstimate > 0 && (
            <span title="Total estimated human effort for this project">
              Σ {formatEstimate(totalEstimate)}
              {loggedEstimate > 0 && (
                <span className="text-emerald-600"> · {formatEstimate(loggedEstimate)} logged</span>
              )}
            </span>
          )}
          {visible.length !== all.length && <span>{visible.length} shown</span>}
        </span>

        {queued > 0 ? (
          <button
            onClick={sync}
            disabled={syncing}
            title={
              failedCount > 0
                ? `${failedCount} TargetProcess operation(s) failed — click to retry`
                : `${pendingCount} operation(s) waiting for TargetProcess`
            }
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-50 ${
              failedCount > 0
                ? "text-red-400 hover:bg-red-500/10"
                : "text-amber-400 hover:bg-amber-500/10"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                failedCount > 0 ? "bg-red-500" : "animate-pulse bg-amber-400"
              }`}
            />
            {syncing
              ? "Syncing…"
              : failedCount > 0
                ? `${failedCount} failed`
                : `${pendingCount} pending`}
          </button>
        ) : (
          <span className="text-[10px] text-slate-700">v{packageJson.version}</span>
        )}
      </div>
    </div>
  );
}
