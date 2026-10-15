// Browser-style tab bar in the window's title area. Tabs are coloured by
// workspace; Kubernetes and database tabs show their environment tier.
// Drag a tab to reorder, middle-click or × to close.

import { useState } from "react";
import { MeetingIndicator } from "../meetings/MeetingIndicator";
import { TIER_STYLE } from "../shared/envKind";
import { SCREEN_META } from "./AppSwitcher";
import type { TabTitle } from "./TabContext";
import type { Tab } from "./tabs";

interface Props {
  tabs: Tab[];
  activeId: string;
  titles: Record<string, TabTitle>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onMove: (id: string, toIndex: number) => void;
}

export function TabBar({ tabs, activeId, titles, onSelect, onClose, onNew, onMove }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);

  return (
    <div
      data-tauri-drag-region
      className="flex h-10 shrink-0 items-end gap-1 border-b border-[var(--line)] bg-[var(--bg)] pr-2 pl-[78px]"
    >
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {tabs.map((tab, index) => {
          const meta = SCREEN_META[tab.screen];
          const title = titles[tab.id];
          const active = tab.id === activeId;
          const tier = title?.tier && title.tier !== "other" ? TIER_STYLE[title.tier] : null;
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={() => setDragging(tab.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragging && dragging !== tab.id) onMove(dragging, index);
              }}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                } else if (e.button === 0) onSelect(tab.id);
              }}
              title={`${meta.label}${title ? ` — ${title.label}` : ""}${index < 9 ? `  (⌘${index + 1})` : ""}`}
              className={`group relative flex h-8 max-w-[220px] min-w-[120px] cursor-default items-center gap-2 rounded-t-lg border border-b-0 px-2.5 text-[12px] select-none ${
                active
                  ? "border-[var(--line-strong)] bg-[var(--panel-solid)] text-slate-100"
                  : "border-transparent text-slate-500 hover:bg-[var(--line-soft)] hover:text-slate-300"
              } ${dragging === tab.id ? "opacity-50" : ""}`}
            >
              {active && <span className="absolute inset-x-2 top-0 h-[2px] rounded-full" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />}
              <span className="shrink-0" style={{ color: active ? meta.color : undefined }}>
                {meta.icon(13)}
              </span>
              <span className="min-w-0 flex-1 truncate">{title?.label ?? (tab.screen === "home" ? "New tab" : meta.label)}</span>
              {tier && (
                <span
                  className="num shrink-0 rounded px-1 text-[8.5px] font-bold tracking-wider"
                  style={{ color: tier.color, background: `${tier.color}1f` }}
                >
                  {tier.label}
                </span>
              )}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onClose(tab.id)}
                className={`shrink-0 rounded px-1 leading-none text-slate-500 hover:bg-[var(--line)] hover:text-slate-100 ${active ? "" : "opacity-0 group-hover:opacity-100"}`}
                title="Close tab (⌘W)"
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          onClick={onNew}
          className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[16px] text-slate-500 hover:bg-[var(--line-soft)] hover:text-slate-200"
          title="New tab (⌘T)"
          aria-label="New tab"
        >
          +
        </button>
      </div>
      <MeetingIndicator />
    </div>
  );
}
