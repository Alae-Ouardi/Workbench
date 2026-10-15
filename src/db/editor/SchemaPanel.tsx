// Left panel: searchable list of tables and views with approximate row
// counts; a click opens the table, the + opens a new SQL tab.

import { useMemo, useState } from "react";
import { IconRefresh, IconSearch } from "../../shared/icons";
import type { TableInfo } from "../types";

function compact(n: number | null): string {
  if (n === null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function SchemaPanel({
  database,
  tables,
  loading,
  error,
  activeTable,
  onOpen,
  onNewQuery,
  onReload,
}: {
  database: string;
  tables: TableInfo[];
  loading: boolean;
  error: string | null;
  activeTable: string | null;
  onOpen: (table: string) => void;
  onNewQuery: () => void;
  onReload: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tables.filter((t) => t.name.toLowerCase().includes(q)) : tables;
  }, [tables, query]);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--line)]">
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className="num truncate text-[12px] font-semibold text-slate-200" title={database}>
          {database}
        </span>
        <span className="num text-[11px] text-slate-600">{tables.length}</span>
        <button className="ml-auto text-slate-500 hover:text-slate-200" onClick={onReload} title="Reload tables">
          <IconRefresh size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-2 py-1.5">
        <IconSearch size={12} className="text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tables…"
          className="bare-input w-full bg-transparent text-[12px] text-slate-100 outline-none placeholder:text-slate-600"
        />
      </div>
      <button className="btn mx-3 mt-2 justify-center py-1 text-xs" onClick={onNewQuery}>
        + New SQL query <kbd className="chip num py-0">⌘N</kbd>
      </button>
      {error && <p className="m-3 text-[11px] text-rose-300">{error}</p>}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {shown.map((t) => (
          <button
            key={t.name}
            onClick={() => onOpen(t.name)}
            title={t.comment || t.name}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12.5px] ${
              activeTable === t.name ? "bg-[var(--line)] text-slate-50" : "text-slate-300 hover:bg-[var(--line-soft)]"
            }`}
          >
            <span className={`text-[10px] ${t.kind === "view" ? "text-violet-300" : "text-amber-300/80"}`}>{t.kind === "view" ? "◇" : "▦"}</span>
            <span className="num min-w-0 flex-1 truncate">{t.name}</span>
            <span className="num text-[10px] text-slate-600">{compact(t.rows)}</span>
          </button>
        ))}
        {!loading && shown.length === 0 && <p className="px-2 py-4 text-[11px] text-slate-600">No tables match.</p>}
      </div>
    </aside>
  );
}
