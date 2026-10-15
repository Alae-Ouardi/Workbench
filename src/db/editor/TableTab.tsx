// A table: browse rows (paging, sort, filters) and edit them — cells, new
// rows, deletes — collected as pending changes, previewed as SQL, confirmed,
// then applied in one transaction. Plus the table's structure.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "../../shared/confirm/ConfirmProvider";
import type { GridCursor, GridSort } from "../../shared/grid/DataGrid";
import { errorText } from "../../k8s/api";
import { db } from "../api";
import { addInsert, cellText, editCount, NO_EDITS, removeInsert, setCell, setInsertCell, toChanges, toggleDelete, type Edits } from "../logic/edits";
import type { Cell, Filter, RowsPage, SessionInfo, TableDetail } from "../types";
import { ExportMenu, ResultsGrid } from "./ResultsGrid";
import { IconMinus, IconPlus } from "../../shared/icons";

const PAGE = 200;
const OPS: Filter["op"][] = [
  "contains",
  "not contains",
  "starts with",
  "ends with",
  "=",
  "!=",
  ">",
  "<",
  ">=",
  "<=",
  "like",
  "not like",
  "is null",
  "is not null",
];

/** Text search for text columns, exact match otherwise. */
const defaultOp = (kind: string | undefined): Filter["op"] => (kind === "text" ? "contains" : "=");

interface Props {
  session: SessionInfo;
  envNames: string[];
  connectionName: string;
  table: string;
  isView: boolean;
}

export function TableTab(props: Props) {
  const [mode, setMode] = useState<"data" | "structure">("data");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--line-soft)] px-3 py-1.5">
        {(["data", "structure"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-2.5 py-1 text-[12px] ${mode === m ? "bg-[var(--line)] text-slate-50" : "text-slate-500 hover:text-slate-200"}`}
          >
            {m === "data" ? "Data" : "Structure"}
          </button>
        ))}
        <span className="num ml-2 truncate text-[12px] text-slate-400">{props.table}</span>
        {props.isView && <span className="chip py-0 text-[10px] text-violet-300">view</span>}
      </div>
      <div className="min-h-0 flex-1">{mode === "data" ? <DataMode {...props} /> : <Structure {...props} />}</div>
    </div>
  );
}

function DataMode({ session, envNames, connectionName, table, isView }: Props) {
  const confirm = useConfirm();
  const id = session.connection_id;
  const [page, setPage] = useState<RowsPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [draftFilters, setDraftFilters] = useState<Filter[]>([]);
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [editing, setEditing] = useState<GridCursor | null>(null);
  const [cursor, setCursor] = useState<GridCursor | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    db.rows(id, { table, offset, limit: PAGE, sort: sort ? [sort.key, sort.dir] : null, filters })
      .then((p) => {
        if (!live) return;
        setPage(p);
        setEdits(NO_EDITS);
        // Keep a "Saved" note across the reload that follows applying.
        setMessage((m) => (m?.tone === "ok" ? m : null));
      })
      .catch((e) => live && setMessage({ tone: "bad", text: errorText(e) }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id, table, offset, sort, filters, tick]);

  const columns = page?.result.columns ?? [];
  const rows = page?.result.rows ?? [];
  const pk = page?.primary_key ?? [];
  // New rows need no key; changing or deleting existing ones does.
  const canInsert = !isView;
  const editable = !isView && pk.length > 0;
  const shownRows: Cell[][] = useMemo(
    () => [...rows, ...edits.inserts.map((ins) => columns.map((c) => (c.name in ins ? ins[c.name] : null)))],
    [rows, edits.inserts, columns],
  );
  const pending = editCount(edits);

  const valueAt = useCallback(
    (row: number, col: number): string | null => {
      const name = columns[col]?.name;
      if (row >= rows.length) return edits.inserts[row - rows.length]?.[name] ?? null;
      const upd = edits.updates[row];
      return upd && name in upd ? upd[name] : cellText(rows[row][col]);
    },
    [columns, rows, edits],
  );

  function commit(row: number, col: number, value: string | null) {
    const name = columns[col].name;
    setEdits((e) => (row >= rows.length ? setInsertCell(e, row - rows.length, name, value) : setCell(e, row, name, value, rows[row][col])));
    setEditing(null);
  }

  async function apply() {
    if (!page) return;
    try {
      const changes = toChanges(edits, rows, columns, pk);
      const batch = await db.prepareChanges(id, table, changes);
      const ok = await confirm({
        title: `Apply ${changes.length} change${changes.length === 1 ? "" : "s"} to ${table}`,
        target: [
          { label: "connection", value: connectionName },
          { label: "database", value: session.database },
          { label: "table", value: table },
        ],
        envNames,
        destructive: edits.deletes.length > 0,
        confirmLabel: "Apply",
        detail: (
          <pre className="num max-h-64 overflow-auto rounded-lg bg-[var(--bg)] p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300">
            {batch.preview.join("\n")}
          </pre>
        ),
      });
      if (!ok) return;
      const result = await db.applyChanges(id, batch.batch_id);
      setMessage({ tone: "ok", text: `Saved — ${result.affected_rows} row${result.affected_rows === 1 ? "" : "s"} changed.` });
      setTick((t) => t + 1);
      setTimeout(() => setMessage((m) => (m?.tone === "ok" ? null : m)), 5000);
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
    }
  }

  // − removes a pending new row outright, or marks an existing one for
  // deletion (again to undo).
  const removable = Boolean(cursor) && (cursor!.row >= rows.length || editable);
  function removeSelected() {
    if (!cursor || !removable) return;
    setEdits(cursor.row >= rows.length ? removeInsert(edits, cursor.row - rows.length) : toggleDelete(edits, cursor.row));
  }

  const renderCell = (row: number, col: number) => {
    if (editing?.row === row && editing.col === col) {
      return <CellEditor initial={valueAt(row, col)} onCommit={(v) => commit(row, col, v)} onCancel={() => setEditing(null)} />;
    }
    const name = columns[col]?.name;
    const edited = row >= rows.length ? name in (edits.inserts[row - rows.length] ?? {}) : name in (edits.updates[row] ?? {});
    if (!edited) return undefined;
    const v = valueAt(row, col);
    return v === null ? <span className="text-[11px] italic text-amber-300/80">NULL</span> : <span className="truncate text-amber-100">{v}</span>;
  };

  const cellClass = (row: number, col: number) => {
    if (row >= rows.length) return "bg-emerald-500/10";
    if (edits.deletes.includes(row)) return "bg-rose-500/10 line-through text-slate-500";
    return columns[col] && edits.updates[row] && columns[col].name in edits.updates[row] ? "bg-amber-500/15" : "";
  };

  const total = page?.total ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button className="btn py-1 text-xs" onClick={() => setDraftFilters([...draftFilters, { column: columns[0]?.name ?? "", op: defaultOp(columns[0]?.kind), value: "" }])} disabled={!columns.length}>
          + Filter
        </button>
        {draftFilters.map((f, i) => (
          <span key={i} className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-1.5 py-0.5">
            <select className="bg-transparent text-[11.5px] text-slate-200 outline-none" value={f.column} onChange={(e) => {
                const kind = columns.find((c) => c.name === e.target.value)?.kind;
                setDraftFilters(draftFilters.map((x, j) => (j === i ? { ...x, column: e.target.value, op: x.value ? x.op : defaultOp(kind) } : x)));
              }}>
              {columns.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
            <select className="bg-transparent text-[11.5px] text-sky-300 outline-none" value={f.op} onChange={(e) => setDraftFilters(draftFilters.map((x, j) => (j === i ? { ...x, op: e.target.value as Filter["op"] } : x)))}>
              {OPS.map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
            {!f.op.startsWith("is") && (
              <input
                className="bare-input num w-28 bg-transparent text-[11.5px] text-slate-100 outline-none"
                value={f.value ?? ""}
                placeholder={f.op.includes("like") ? "%text%" : f.op.includes("contains") || f.op.includes("with") ? "text" : "value"}
                onChange={(e) => setDraftFilters(draftFilters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                onKeyDown={(e) => e.key === "Enter" && (setOffset(0), setFilters(draftFilters))}
              />
            )}
            <button className="text-slate-500 hover:text-rose-300" onClick={() => setDraftFilters(draftFilters.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        {JSON.stringify(draftFilters) !== JSON.stringify(filters) && (
          <button
            className="btn btn-primary py-1 text-xs"
            onClick={() => {
              setOffset(0);
              setFilters(draftFilters);
            }}
          >
            Apply filters
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          {pending > 0 && (
            <>
              <button className="btn py-1 text-xs" onClick={() => setEdits(NO_EDITS)}>
                Discard
              </button>
              <button className="btn btn-primary py-1 text-xs" onClick={() => void apply()}>
                Review & apply ({pending})
              </button>
            </>
          )}
          <ExportMenu columns={columns} rows={rows} table={table} />
          <button className="btn py-1 text-xs" onClick={() => setTick((t) => t + 1)} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </span>
      </div>
      {!editable && page && (
        <p className="mx-3 mb-2 text-[11px] text-slate-500">
          {isView
            ? "Views are read-only."
            : "This table has no primary key: you can add rows, but changing or deleting existing ones needs a SQL tab."}
        </p>
      )}
      {message && (
        <p className={`mx-3 mb-2 rounded-lg px-3 py-1.5 text-[12px] whitespace-pre-wrap ${message.tone === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
          {message.text}
        </p>
      )}
      <div className="min-h-0 flex-1 px-3">
        <ResultsGrid
          columns={columns}
          rows={shownRows}
          rowOffset={offset}
          sort={sort}
          onSort={(s) => {
            setOffset(0);
            setSort(s);
          }}
          renderCell={renderCell}
          cellClass={cellClass}
          cursor={cursor}
          onCursor={setCursor}
          onActivate={(c) =>
            (c.row >= rows.length ? canInsert : editable) && !edits.deletes.includes(c.row) && columns[c.col]?.kind !== "binary" && setEditing(c)
          }
        />
      </div>
      <div className="flex items-center gap-3 px-3 py-2 text-[11.5px] text-slate-500">
        {canInsert && (
          <span className="flex overflow-hidden rounded-lg border border-[var(--line)]">
            <button
              className="flex h-7 w-8 items-center justify-center text-slate-300 hover:bg-emerald-500/15 hover:text-emerald-200"
              title="Add a row (saved when you apply)"
              aria-label="Add row"
              onClick={() => {
                setEdits(addInsert(edits));
                setCursor({ row: rows.length + edits.inserts.length, col: 0 });
              }}
            >
              <IconPlus size={14} />
            </button>
            <button
              className="flex h-7 w-8 items-center justify-center border-l border-[var(--line)] text-slate-300 hover:bg-rose-500/15 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-35"
              disabled={!removable}
              title={
                !cursor
                  ? "Select a row to delete"
                  : cursor.row < rows.length && !editable
                    ? "Deleting existing rows needs a primary key — use a SQL tab"
                    : cursor.row < rows.length && edits.deletes.includes(cursor.row)
                      ? "Undo delete"
                      : "Delete the selected row (saved when you apply)"
              }
              aria-label="Delete row"
              onClick={removeSelected}
            >
              <IconMinus size={14} />
            </button>
          </span>
        )}
        <span className="num">
          {total === 0 ? "No rows" : `${(offset + 1).toLocaleString()}–${Math.min(offset + PAGE, total).toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        <button className="btn py-0.5 text-xs" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          ‹ Prev
        </button>
        <button className="btn py-0.5 text-xs" disabled={offset + PAGE >= total || loading} onClick={() => setOffset(offset + PAGE)}>
          Next ›
        </button>
        {editable && <span className="ml-auto">Double-click or ↵ to edit a cell · ⌘C copies</span>}
      </div>
    </div>
  );
}

function CellEditor({ initial, onCommit, onCancel }: { initial: string | null; onCommit: (v: string | null) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial ?? "");
  const [isNull, setIsNull] = useState(initial === null);
  return (
    <span className="flex w-full items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        className="bare-input num min-w-0 flex-1 rounded bg-[var(--bg)] px-1 text-[12px] text-slate-50 outline outline-1 outline-[var(--acc-400)]"
        value={isNull ? "" : value}
        placeholder={isNull ? "NULL" : ""}
        onChange={(e) => {
          setIsNull(false);
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onCommit(isNull ? null : value);
          else if (e.key === "Escape") onCancel();
        }}
        onBlur={() => onCommit(isNull ? null : value)}
      />
      <button
        className={`rounded px-1 text-[9px] font-bold ${isNull ? "bg-amber-400/20 text-amber-200" : "text-slate-500 hover:text-slate-200"}`}
        onMouseDown={(e) => {
          e.preventDefault();
          setIsNull(!isNull);
        }}
        title="Set to NULL"
      >
        NULL
      </button>
    </span>
  );
}

function Structure({ session, table }: Props) {
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    db.tableDetail(session.connection_id, table).then(setDetail).catch((e) => setError(errorText(e)));
  }, [session.connection_id, table]);
  if (error) return <p className="p-4 text-xs text-rose-300">{error}</p>;
  if (!detail) return <p className="p-4 text-xs text-slate-500">Loading…</p>;
  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left">
            {["Column", "Type", "Null", "Key", "Default", "Extra", "Comment"].map((h) => (
              <th key={h} className="label border-b border-[var(--line)] px-2 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.columns.map((c) => (
            <tr key={c.name} className="border-b border-[var(--line-soft)] hover:bg-[var(--line-soft)]">
              <td className="num px-2 py-1.5 font-medium text-slate-100">
                {c.key === "PRI" && <span className="mr-1 text-amber-300" title="Primary key">⚿</span>}
                {c.name}
              </td>
              <td className="num px-2 py-1.5 text-sky-300">{c.column_type}</td>
              <td className="px-2 py-1.5 text-slate-400">{c.nullable ? "yes" : "no"}</td>
              <td className="num px-2 py-1.5 text-amber-300/80">{c.key}</td>
              <td className="num px-2 py-1.5 text-slate-400">{c.default ?? <span className="italic text-slate-600">NULL</span>}</td>
              <td className="px-2 py-1.5 text-slate-500">{c.extra}</td>
              <td className="px-2 py-1.5 text-slate-500">{c.comment}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 className="label mt-6 mb-2">Indexes</h3>
      <div className="space-y-1">
        {detail.indexes.map((i) => (
          <div key={i.name} className="flex items-center gap-2 text-[12px]">
            <span className="num w-48 truncate text-slate-200">{i.name}</span>
            {i.unique && <span className="chip py-0 text-[10px] text-amber-300">unique</span>}
            <span className="num text-slate-400">({i.columns.join(", ")})</span>
          </div>
        ))}
        {detail.indexes.length === 0 && <p className="text-[11px] text-slate-600">No indexes.</p>}
      </div>
    </div>
  );
}
