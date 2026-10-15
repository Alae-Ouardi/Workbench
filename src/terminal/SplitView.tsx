// A folder's panes laid out from its split tree. Panes are drawn in one flat,
// absolutely positioned layer keyed by pane id, so splitting or closing never
// remounts — and never restarts — the other shells. Dividers sit on top.

import { useMemo, useRef } from "react";
import type { XtermHandle } from "../shared/terminal/XtermView";
import { panes, rects, splitRects } from "./logic/layout";
import { BrowserPane } from "./BrowserPane";
import { TerminalPane } from "./TerminalPane";
import type { TermTab } from "./types";

/** Half the gap between panes, in px. */
const GAP = 3;

interface Props {
  folderId: string;
  tab: TermTab;
  visible: boolean;
  onFocus: (paneId: string) => void;
  onResize: (splitId: string, ratio: number) => void;
  /** Close one pane of a split. */
  onClose: (paneId: string) => void;
  register: (paneId: string, handle: XtermHandle | null) => void;
}

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

export function SplitView({ folderId, tab, visible, onFocus, onResize, onClose, register }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const list = useMemo(() => panes(tab.layout), [tab.layout]);
  const areas = useMemo(() => rects(tab.layout), [tab.layout]);
  const splits = useMemo(() => splitRects(tab.layout), [tab.layout]);
  const single = list.length === 1;

  function drag(e: React.PointerEvent, split: (typeof splits)[number]) {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const bounds = el.getBoundingClientRect();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const { area, dir } = split;
      const ratio =
        dir === "row"
          ? ((ev.clientX - bounds.left) / bounds.width - area.x) / area.w
          : ((ev.clientY - bounds.top) / bounds.height - area.y) / area.h;
      onResize(split.id, ratio);
    };
    const done = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", done);
      target.removeEventListener("pointercancel", done);
      target.removeEventListener("lostpointercapture", done);
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", done);
    target.addEventListener("pointercancel", done);
    target.addEventListener("lostpointercapture", done);
  }

  return (
    <div ref={box} className="absolute inset-0" style={{ display: visible ? "block" : "none" }}>
      {list.map((p) => {
        const r = areas.get(p.id)!;
        const focused = tab.focused === p.id;
        return (
          <div
            key={p.id}
            className={`absolute overflow-hidden rounded-lg border bg-[#011627] ${
              focused && !single ? "border-[rgb(34_211_238/0.55)] shadow-[0_0_0_1px_rgb(34_211_238/0.15)]" : "border-[var(--line)]"
            }`}
            style={{
              left: `calc(${pct(r.x)} + ${GAP}px)`,
              top: `calc(${pct(r.y)} + ${GAP}px)`,
              width: `calc(${pct(r.w)} - ${GAP * 2}px)`,
              height: `calc(${pct(r.h)} - ${GAP * 2}px)`,
            }}
          >
            {p.view === "browser" ? (
              <BrowserPane
                folderId={folderId}
                paneId={p.id}
                url={p.url ?? ""}
                visible={visible}
                onFocus={() => onFocus(p.id)}
                onClose={single ? undefined : () => onClose(p.id)}
              />
            ) : (
              <div className="group/pane relative h-full w-full p-1.5">
                {!single && (
                  <button
                    className="absolute top-1.5 right-2 z-10 flex h-5 w-5 items-center justify-center rounded-md bg-[#011627]/80 text-[13px] leading-none text-slate-400 opacity-60 hover:bg-rose-500/20 hover:text-rose-200 hover:opacity-100 group-hover/pane:opacity-100"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onClose(p.id)}
                    title="Close this pane (⌥⌘W)"
                    aria-label="Close pane"
                  >
                    ×
                  </button>
                )}
                <TerminalPane
                  cwd={p.cwd}
                  visible={visible}
                  focused={focused}
                  onFocus={() => onFocus(p.id)}
                  register={(h) => register(p.id, h)}
                />
              </div>
            )}
          </div>
        );
      })}
      {splits.map((s) => {
        const { area, dir, ratio } = s;
        const style =
          dir === "row"
            ? { left: `calc(${pct(area.x + area.w * ratio)} - ${GAP + 1}px)`, top: pct(area.y), width: GAP * 2 + 2, height: pct(area.h) }
            : { top: `calc(${pct(area.y + area.h * ratio)} - ${GAP + 1}px)`, left: pct(area.x), height: GAP * 2 + 2, width: pct(area.w) };
        return (
          <div
            key={s.id}
            onPointerDown={(e) => drag(e, s)}
            className={`absolute z-10 rounded-full transition-colors hover:bg-sky-400/40 ${dir === "row" ? "cursor-col-resize" : "cursor-row-resize"}`}
            style={style}
            role="separator"
            aria-orientation={dir === "row" ? "vertical" : "horizontal"}
          />
        );
      })}
    </div>
  );
}
