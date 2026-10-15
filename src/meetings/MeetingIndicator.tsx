// Tab-bar badge: a live timer with Split / Stop while a call is tracked, or
// how many finished meetings still need logging.

import { useState } from "react";
import { appNames, elapsed } from "./logic";
import { useMeetings } from "./MeetingProvider";
import { useNow } from "./useNow";

const ACTION_BUTTON = "rounded-md px-1.5 py-0.5 text-slate-300 hover:bg-[var(--line)] hover:text-slate-100 disabled:opacity-50";

export function MeetingIndicator() {
  const { live, pending, split, stop, openPopup } = useMeetings();
  const now = useNow(live.active);
  const [busy, setBusy] = useState(false);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error("meeting action failed", e);
    } finally {
      setBusy(false);
    }
  };

  if (live.active && live.started_at) {
    return (
      <div className="mb-1 flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 py-0.5 pr-1 pl-2 text-[11.5px]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400 shadow-[0_0_8px_#fb7185]" />
        <span className="text-rose-200" title={live.apps.length ? `Microphone used by ${appNames(live.apps)}` : undefined}>
          In meeting
        </span>
        <span className="num text-rose-100">{elapsed(live.started_at, now)}</span>
        <button
          className={ACTION_BUTTON}
          onClick={run(split)}
          disabled={busy}
          title="Log this part now and keep tracking the rest as a new meeting"
        >
          Split
        </button>
        <button
          className={ACTION_BUTTON}
          onClick={run(stop)}
          disabled={busy}
          title="Log what was tracked so far and stop tracking this call"
        >
          Stop
        </button>
      </div>
    );
  }

  if (pending.length) {
    return (
      <button
        className="mb-1 flex shrink-0 items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11.5px] text-sky-200 hover:bg-sky-500/20"
        onClick={() => openPopup()}
        title="Log the time of finished meetings"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
        {pending.length} meeting{pending.length > 1 ? "s" : ""} to log
      </button>
    );
  }

  return null;
}
