// A browser pane: toolbar in the page, and a real web view (native, drawn
// above the page) kept exactly over the pane's content area. It hides when the
// folder or tab is not shown, or while an app pop-up is open.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { useAnyOverlay } from "../shared/overlay";
import { DEV_PORTS, shortUrl, toUrl } from "./logic/url";
import { terminalStore } from "./store";

interface Props {
  folderId: string;
  paneId: string;
  url: string;
  visible: boolean;
  onFocus: () => void;
  /** Set when the pane is one of a split: shows a close button. */
  onClose?: () => void;
}

interface BrowserState {
  pane_id: string;
  url: string;
  title: string | null;
  loading: boolean | null;
}

const ICON_BTN = "flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-[var(--line)] hover:text-slate-100 disabled:opacity-30";

export function BrowserPane({ folderId, paneId, url, visible, onFocus, onClose }: Props) {
  const area = useRef<HTMLDivElement>(null);
  const overlay = useAnyOverlay();
  const [address, setAddress] = useState(url);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const show = visible && !overlay && Boolean(url);
  // Latest wishes, read by the sync loop without restarting it.
  const want = useRef({ show, url });
  want.current = { show, url };

  // One loop per pane keeps the native view matching the pane: shown over
  // the content area (following splits, sidebar, window), hidden, or closed.
  // The backend applies requests one at a time and is idempotent; a request
  // is only re-sent when something changed, never in a retry storm.
  useEffect(() => {
    let frame = 0;
    let last = "";
    let inFlight = false;
    let cancelled = false;
    const tick = () => {
      const el = area.current;
      const { show: wanted, url: target } = want.current;
      const r = el?.getBoundingClientRect();
      const onScreen = Boolean(wanted && target && r && r.width > 0 && r.height > 0);
      const key = onScreen ? `1|${target}|${r!.x}|${r!.y}|${r!.width}|${r!.height}` : `0|${target}`;
      if (key !== last && !inFlight) {
        last = key;
        inFlight = true;
        invoke("browser_sync", {
          paneId,
          url: target,
          visible: onScreen,
          x: r?.x ?? 0,
          y: r?.y ?? 0,
          width: r?.width ?? 0,
          height: r?.height ?? 0,
        })
          .then(() => !cancelled && setError(null))
          .catch((e) => !cancelled && setError(String(e)))
          .finally(() => {
            inFlight = false;
          });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      // Always: the view may exist even if its creation hadn't answered yet.
      void invoke("browser_close", { paneId }).catch(() => {});
    };
  }, [paneId]);

  // Address, title and loading state as the page navigates.
  useEffect(() => {
    let cancelled = false;
    const unlisten = listen<BrowserState>("browser-state", ({ payload }) => {
      if (cancelled || payload.pane_id !== paneId) return;
      if (payload.title !== null) {
        setTitle(payload.title);
        terminalStore.setPage(folderId, paneId, { title: payload.title });
      }
      if (payload.loading !== null) setLoading(payload.loading);
      setAddress(payload.url);
      setError(null);
      if (payload.loading === false) terminalStore.setPage(folderId, paneId, { url: payload.url });
    });
    return () => {
      cancelled = true;
      void unlisten.then((u) => u());
    };
  }, [folderId, paneId]);

  function go(input: string) {
    const next = toUrl(input);
    if (!next) return setError(`'${input}' is not a web address.`);
    setError(null);
    setAddress(next);
    // An open view navigates; otherwise the sync loop creates it at `next`.
    invoke("browser_navigate", { paneId, url: next }).catch(() => {});
    terminalStore.setPage(folderId, paneId, { url: next });
  }

  /** Back to the start picker; the sync loop closes the view. */
  function home() {
    setTitle(null);
    setAddress("");
    terminalStore.setPage(folderId, paneId, { url: "", title: "" });
  }

  const act = (action: "back" | "forward" | "reload") => () =>
    void invoke("browser_go", { paneId, action }).catch((e) => setError(String(e)));

  return (
    <div className="flex h-full w-full flex-col" onMouseDown={onFocus}>
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--line)] bg-[var(--panel)] px-1.5 py-1">
        <button className={ICON_BTN} onClick={act("back")} disabled={!url} title="Back" aria-label="Back">
          ‹
        </button>
        <button className={ICON_BTN} onClick={act("forward")} disabled={!url} title="Forward" aria-label="Forward">
          ›
        </button>
        <button className={ICON_BTN} onClick={act("reload")} disabled={!url} title="Reload" aria-label="Reload">
          ⟳
        </button>
        <button className={ICON_BTN} onClick={home} title="Start page" aria-label="Start page">
          ⌂
        </button>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            go(address);
          }}
        >
          <input
            className="num w-full rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-[11.5px] text-slate-200 outline-none focus:border-sky-500/50"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="localhost:3000, a URL or a search"
            spellCheck={false}
          />
        </form>
        <button
          className={ICON_BTN}
          onClick={() => url && void openUrl(url).catch((e) => setError(String(e)))}
          disabled={!url}
          title="Open in your browser"
          aria-label="Open in your browser"
        >
          ↗
        </button>
        {onClose && (
          <button className={`${ICON_BTN} hover:!bg-rose-500/20 hover:!text-rose-200`} onClick={onClose} title="Close this pane (⌥⌘W)" aria-label="Close pane">
            ×
          </button>
        )}
      </div>
      {loading && <div className="h-0.5 shrink-0 animate-pulse bg-sky-400/70" />}
      {error && <p className="shrink-0 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">{error}</p>}
      <div ref={area} className="relative min-h-0 flex-1 bg-white/[0.02]">
        {!url ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
            <p className="text-[12px] text-slate-400">Open a local dev server or any page</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {DEV_PORTS.map(({ port, hint }) => (
                <button key={port} className="rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-left hover:border-sky-500/40 hover:bg-sky-500/5" onClick={() => go(String(port))} title={hint}>
                  <div className="num text-[12px] text-slate-100">:{port}</div>
                  <div className="truncate text-[10px] text-slate-500">{hint}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          !show && (
            <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
              {overlay ? "" : title ?? shortUrl(url)}
            </div>
          )
        )}
      </div>
    </div>
  );
}
