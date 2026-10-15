import { useCallback, useEffect, useState } from "react";
import {
  onBoardChanged,
  tpDismissQueueItem,
  tpListQueue,
  tpRetryAllQueueItems,
  tpRetryQueueItem,
  tpSyncNow,
} from "../../api";
import type { SyncQueueItem } from "../../types";

/**
 * Everything waiting to reach TargetProcess, with the failure reason on each
 * item. This is where a bad token or a missing workflow state becomes visible
 * and fixable, since the board itself never blocks on a sync failure.
 */
export function SyncQueuePanel() {
  const [items, setItems] = useState<SyncQueueItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    tpListQueue()
      .then(setItems)
      .catch((e) => setNote(String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = onBoardChanged(refresh);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [refresh]);

  const failed = items.filter((i) => i.exhausted);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setNote(null);
    try {
      await action();
      refresh();
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-[var(--line-soft)] bg-[var(--panel)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Sync queue
          {items.length > 0 && (
            <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
              {items.length} queued
              {failed.length > 0 && (
                <span className="text-red-400"> · {failed.length} failed</span>
              )}
            </span>
          )}
        </h2>
        <div className="flex gap-2">
          {failed.length > 0 && (
            <button
              disabled={busy}
              onClick={() => act(tpRetryAllQueueItems)}
              className="rounded border border-[var(--line)] px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              Retry all
            </button>
          )}
          <button
            disabled={busy || items.length === 0}
            onClick={() =>
              act(async () => {
                const report = await tpSyncNow();
                setNote(
                  report.error
                    ? report.error
                    : `Pushed ${report.succeeded} operation(s); ${report.pending} still queued.`,
                );
              })
            }
            className="rounded bg-sky-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40 disabled:hover:bg-sky-700"
          >
            {busy ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </div>

      {note && <p className="text-[11px] text-amber-500">{note}</p>}

      {items.length === 0 ? (
        <p className="text-xs text-slate-600">
          Nothing queued — everything is in sync.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line-soft)]">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs text-slate-300">
                  <span className={item.exhausted ? "text-red-400" : "text-slate-400"}>
                    {item.label}
                  </span>
                  {item.task_title && (
                    <>
                      {" — "}
                      <span className="text-slate-400">{item.task_title}</span>
                    </>
                  )}
                </p>
                {item.last_error ? (
                  <p className="mt-0.5 break-words text-[10px] leading-relaxed text-red-400/80">
                    attempt {item.attempts}: {item.last_error}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[10px] text-slate-600">waiting to be pushed</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {item.attempts > 0 && (
                  <button
                    disabled={busy}
                    onClick={() => act(() => tpRetryQueueItem(item.id))}
                    className="text-[10px] text-slate-500 hover:text-sky-400 disabled:opacity-40"
                  >
                    Retry
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => act(() => tpDismissQueueItem(item.id))}
                  title="Give up on this operation and remove it from the queue"
                  className="text-[10px] text-slate-500 hover:text-red-400 disabled:opacity-40"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
