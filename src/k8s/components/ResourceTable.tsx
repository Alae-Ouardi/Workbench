// Generic resource table driven by column definitions. Rows are selectable
// by click or ↑/↓; the selected row opens in the detail panel.

import { useEffect, useRef } from "react";
import type { CellContext, ColumnDef } from "../logic/columns";
import type { Tone } from "../logic/status";
import type { K8sObject } from "../types";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-rose-400",
  idle: "text-slate-500",
  info: "text-sky-400",
};

export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-400 shadow-[0_0_6px_#34d399]",
  warn: "bg-amber-400",
  bad: "bg-rose-400 shadow-[0_0_6px_#fb7185]",
  idle: "bg-slate-500",
  info: "bg-sky-400",
};

const MAX_ROWS = 600;

interface Props {
  columns: ColumnDef[];
  objects: K8sObject[];
  ctx: CellContext;
  selected: string | null;
  onSelect: (o: K8sObject) => void;
  sort: { key: string; dir: "asc" | "desc" };
  onSort: (key: string) => void;
}

export function ResourceTable({ columns, objects, ctx, selected, onSelect, sort, onSort }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const template = columns.map((c) => c.width).join(" ");
  const shown = objects.slice(0, MAX_ROWS);
  const index = shown.findIndex((o) => o.metadata.uid === selected);

  useEffect(() => {
    body.current?.querySelector(`[data-uid="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? Math.min(index + 1, shown.length - 1) : Math.max(index - 1, 0);
    if (shown[next]) onSelect(shown[next]);
  }

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl outline-none focus-visible:border-[var(--line-strong)]"
    >
      <div ref={body} className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: "max-content" }} className="min-w-full">
          <div
            className="sticky top-0 z-10 grid gap-3 border-b border-[var(--line)] bg-[var(--panel-solid)] px-4 py-2.5"
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c) => (
              <button
                key={c.key}
                onClick={() => onSort(c.key)}
                className={`label flex items-center gap-1 truncate hover:text-slate-300 ${c.align === "right" ? "justify-end" : ""} ${
                  sort.key === c.key ? "text-sky-300" : ""
                }`}
              >
                {c.title}
                {sort.key === c.key && <span>{sort.dir === "asc" ? "↑" : "↓"}</span>}
              </button>
            ))}
          </div>
          {shown.map((o) => {
            const active = o.metadata.uid === selected;
            return (
              <div
                key={o.metadata.uid}
                data-uid={o.metadata.uid}
                onClick={() => onSelect(o)}
                className={`grid cursor-pointer items-center gap-3 border-b border-[var(--line-soft)] px-4 py-2 text-[12.5px] transition-colors ${
                  active ? "bg-[rgb(34_211_238/0.09)] shadow-[inset_2px_0_0_var(--acc-400)]" : "hover:bg-[var(--line-soft)]"
                }`}
                style={{ gridTemplateColumns: template }}
              >
                {columns.map((c, i) => {
                  const cell = c.cell(o, ctx);
                  const toned = cell.tone && c.key === "status";
                  return (
                    <span
                      key={c.key}
                      title={cell.title ?? cell.text}
                      className={`flex min-w-0 items-center gap-1.5 ${c.align === "right" ? "justify-end" : ""} ${
                        cell.mono ? "num" : ""
                      } ${cell.tone ? TONE_CLASS[cell.tone] : i === 0 ? "font-medium text-slate-100" : "text-slate-300"}`}
                    >
                      {toned && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[cell.tone!]}`} />}
                      <span className="truncate">{cell.text}</span>
                    </span>
                  );
                })}
              </div>
            );
          })}
          {objects.length > MAX_ROWS && (
            <p className="px-4 py-3 text-center text-[11px] text-slate-500">
              Showing {MAX_ROWS} of {objects.length}. Type in the filter to narrow down.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
