// Virtualized data grid: only visible rows are rendered, so tables with tens of
// thousands of rows scroll smoothly. Sortable, resizable columns, a keyboard
// cell cursor and ⌘C copy. Editing is left to the parent through callbacks.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { copyText } from "../clipboard";
import { clampWidth, displayText, moveCursor, toTsv, type CellValue } from "./gridLogic";

export interface GridColumn {
  key: string;
  title: string;
  /** Second header line, e.g. the SQL type. */
  subtitle?: string;
  width: number;
  align?: "left" | "right";
  sortable?: boolean;
  /** Marks a key column (shown with an accent). */
  accent?: boolean;
}

export interface GridSort {
  key: string;
  dir: "asc" | "desc";
}

export interface GridCursor {
  row: number;
  col: number;
}

interface Props {
  columns: GridColumn[];
  rowCount: number;
  getValue: (row: number, col: number) => CellValue;
  /** Custom cell content; return undefined to use the default rendering. */
  renderCell?: (row: number, col: number) => ReactNode | undefined;
  /** Extra classes per cell (edited, deleted…). */
  cellClass?: (row: number, col: number) => string;
  sort?: GridSort | null;
  onSort?: (sort: GridSort | null) => void;
  cursor?: GridCursor | null;
  onCursor?: (cursor: GridCursor) => void;
  /** Enter or double-click on a cell. */
  onActivate?: (cursor: GridCursor) => void;
  /** Row number gutter on the left. */
  rowNumbers?: boolean;
  /** First row number shown (for paged data). */
  rowOffset?: number;
  rowHeight?: number;
  emptyText?: string;
}

const HEADER_HEIGHT = 40;

export function DataGrid({
  columns,
  rowCount,
  getValue,
  renderCell,
  cellClass,
  sort,
  onSort,
  cursor,
  onCursor,
  onActivate,
  rowNumbers = true,
  rowOffset = 0,
  rowHeight = 30,
  emptyText = "No rows",
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const gutter = rowNumbers ? Math.max(44, String(rowOffset + rowCount).length * 8 + 20) : 0;

  const widthOf = (c: GridColumn) => widths[c.key] ?? c.width;
  const lefts = useMemo(() => {
    let x = gutter;
    return columns.map((c) => {
      const left = x;
      x += widths[c.key] ?? c.width;
      return left;
    });
  }, [columns, widths, gutter]);
  const totalWidth = gutter + columns.reduce((sum, c) => sum + widthOf(c), 0);

  const virtual = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // Keep the cursor cell in view when it moves by keyboard.
  useEffect(() => {
    if (!cursor) return;
    virtual.scrollToIndex(cursor.row, { align: "auto" });
    const el = scroller.current;
    const left = lefts[cursor.col];
    const right = left + widthOf(columns[cursor.col] ?? { width: 0 } as GridColumn);
    if (el && left !== undefined) {
      if (left - gutter < el.scrollLeft) el.scrollLeft = left - gutter;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor?.row, cursor?.col]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!cursor || !onCursor) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "c") {
      e.preventDefault();
      void copyText(toTsv([[getValue(cursor.row, cursor.col)]]));
      return;
    }
    if (e.key === "Enter" && onActivate) {
      e.preventDefault();
      onActivate(cursor);
      return;
    }
    const next = moveCursor(cursor, e.key, rowCount, columns.length);
    // Only swallow keys that actually move (so Tab can leave the grid at the end).
    if (next.row !== cursor.row || next.col !== cursor.col) {
      e.preventDefault();
      onCursor(next);
    }
  }

  function startResize(e: React.PointerEvent, col: GridColumn) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(col);
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [col.key]: clampWidth(startW + ev.clientX - startX) }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function toggleSort(col: GridColumn) {
    if (!onSort || col.sortable === false) return;
    if (sort?.key !== col.key) onSort({ key: col.key, dir: "asc" });
    else if (sort.dir === "asc") onSort({ key: col.key, dir: "desc" });
    else onSort(null);
  }

  return (
    <div
      ref={scroller}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative h-full min-h-0 overflow-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] outline-none focus-visible:border-[var(--line-strong)]"
    >
      <div style={{ width: totalWidth, height: virtual.getTotalSize() + HEADER_HEIGHT, position: "relative" }}>
        {/* header */}
        <div
          className="sticky top-0 z-20 flex border-b border-[var(--line)] bg-[var(--panel-solid)]"
          style={{ height: HEADER_HEIGHT, width: totalWidth }}
        >
          {rowNumbers && <div className="sticky left-0 z-10 shrink-0 bg-[var(--panel-solid)]" style={{ width: gutter }} />}
          {columns.map((col) => {
            const active = sort?.key === col.key;
            return (
              <div
                key={col.key}
                onClick={() => toggleSort(col)}
                className={`group relative flex shrink-0 cursor-default select-none flex-col justify-center border-r border-[var(--line-soft)] px-2.5 ${
                  onSort && col.sortable !== false ? "hover:bg-[var(--line-soft)]" : ""
                }`}
                style={{ width: widthOf(col) }}
                title={col.subtitle ? `${col.title} · ${col.subtitle}` : col.title}
              >
                <span className={`flex items-center gap-1 truncate text-[12px] font-semibold ${col.accent ? "text-amber-300" : "text-slate-200"}`}>
                  {col.title}
                  {active && <span className="text-sky-400">{sort!.dir === "asc" ? "↑" : "↓"}</span>}
                </span>
                {col.subtitle && <span className="num truncate text-[10px] text-slate-500">{col.subtitle}</span>}
                <span
                  onPointerDown={(e) => startResize(e, col)}
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover:bg-[var(--acc-400)]/40 group-hover:opacity-100"
                />
              </div>
            );
          })}
        </div>

        {rowCount === 0 && <p className="px-4 py-10 text-center text-xs text-slate-500">{emptyText}</p>}

        {virtual.getVirtualItems().map((vr) => {
          const row = vr.index;
          return (
            <div
              key={vr.key}
              className="absolute left-0 flex border-b border-[var(--line-soft)] hover:bg-[var(--line-soft)]"
              style={{ top: vr.start + HEADER_HEIGHT, height: rowHeight, width: totalWidth }}
            >
              {rowNumbers && (
                <div
                  className="num sticky left-0 z-10 flex shrink-0 items-center justify-end border-r border-[var(--line-soft)] bg-[var(--panel-solid)] pr-2 text-[10px] text-slate-600"
                  style={{ width: gutter }}
                >
                  {rowOffset + row + 1}
                </div>
              )}
              {columns.map((col, c) => {
                const selected = cursor?.row === row && cursor.col === c;
                const custom = renderCell?.(row, c);
                const value = custom === undefined ? getValue(row, c) : null;
                return (
                  <div
                    key={col.key}
                    onMouseDown={() => onCursor?.({ row, col: c })}
                    onDoubleClick={() => onActivate?.({ row, col: c })}
                    className={`flex shrink-0 items-center overflow-hidden border-r border-[var(--line-soft)] px-2.5 text-[12px] ${
                      col.align === "right" ? "justify-end" : ""
                    } ${selected ? "outline outline-2 -outline-offset-2 outline-[var(--acc-400)]" : ""} ${cellClass?.(row, c) ?? ""}`}
                    style={{ width: widthOf(col) }}
                  >
                    {custom !== undefined ? (
                      custom
                    ) : value === null || value === undefined ? (
                      <span className="text-[11px] italic text-slate-600">NULL</span>
                    ) : (
                      <span className={`truncate ${typeof value === "number" ? "num text-amber-200" : "text-slate-200"}`}>
                        {displayText(value)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
