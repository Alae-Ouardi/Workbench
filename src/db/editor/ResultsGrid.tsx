// A result set in the shared data grid, with sizing from the data and an
// export menu (CSV, JSON, copy as INSERT).

import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState, type ReactNode } from "react";
import { copyText } from "../../shared/clipboard";
import { DataGrid, type GridColumn, type GridCursor, type GridSort } from "../../shared/grid/DataGrid";
import { guessWidth } from "../../shared/grid/gridLogic";
import { toCsv, toInserts, toJson } from "../logic/export";
import type { Cell, ColumnMeta } from "../types";

export function gridColumns(columns: ColumnMeta[], rows: Cell[][], extra?: (c: ColumnMeta) => Partial<GridColumn>): GridColumn[] {
  return columns.map((c, i) => ({
    key: c.name,
    title: c.name,
    width: guessWidth(c.name, rows.slice(0, 60).map((r) => r[i])),
    align: c.kind === "number" ? "right" : undefined,
    ...extra?.(c),
  }));
}

export function ResultsGrid({
  columns,
  rows,
  rowOffset = 0,
  sort,
  onSort,
  renderCell,
  cellClass,
  onActivate,
  cursor,
  onCursor,
  extraColumn,
}: {
  columns: ColumnMeta[];
  rows: Cell[][];
  rowOffset?: number;
  sort?: GridSort | null;
  onSort?: (s: GridSort | null) => void;
  renderCell?: (row: number, col: number) => ReactNode | undefined;
  cellClass?: (row: number, col: number) => string;
  onActivate?: (c: GridCursor) => void;
  cursor?: GridCursor | null;
  onCursor?: (c: GridCursor) => void;
  extraColumn?: (c: ColumnMeta) => Partial<GridColumn>;
}) {
  const [ownCursor, setOwnCursor] = useState<GridCursor | null>(null);
  const cols = useMemo(() => gridColumns(columns, rows, extraColumn), [columns, rows, extraColumn]);
  return (
    <DataGrid
      columns={cols}
      rowCount={rows.length}
      getValue={(r, c) => rows[r]?.[c] ?? null}
      renderCell={renderCell}
      cellClass={cellClass}
      sort={sort}
      onSort={onSort}
      cursor={cursor ?? ownCursor}
      onCursor={onCursor ?? setOwnCursor}
      onActivate={onActivate}
      rowOffset={rowOffset}
    />
  );
}

export function ExportMenu({ columns, rows, table }: { columns: ColumnMeta[]; rows: Cell[][]; table: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const flash = (label: string) => {
    setDone(label);
    setOpen(false);
    setTimeout(() => setDone(null), 1500);
  };
  async function saveAs(ext: "csv" | "json") {
    const saved = await invoke<boolean>("save_text_file", {
      defaultName: `${table || "result"}.${ext}`,
      contents: ext === "csv" ? toCsv(columns, rows) : toJson(columns, rows),
    });
    if (saved) flash("Saved ✓");
  }
  return (
    <div className="relative">
      <button className="btn py-1 text-xs" onClick={() => setOpen(!open)} disabled={!rows.length}>
        {done ?? "Export ▾"}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-48 rounded-xl border border-[var(--line-strong)] bg-[var(--panel-solid)] p-1 shadow-2xl" onMouseLeave={() => setOpen(false)}>
          {[
            ["Save as CSV…", () => void saveAs("csv")],
            ["Save as JSON…", () => void saveAs("json")],
            ["Copy as CSV", () => void copyText(toCsv(columns, rows)).then(() => flash("Copied ✓"))],
            ["Copy as INSERT", () => void copyText(toInserts(table || columns[0]?.table || "table", columns, rows)).then(() => flash("Copied ✓"))],
          ].map(([label, run]) => (
            <button key={label as string} onClick={run as () => void} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-slate-300 hover:bg-[var(--line)]">
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
