// The editor for a connected database: schema panel on the left, editor tabs
// (tables and SQL queries) on the right. Open tabs and query drafts are kept
// per connection.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SQLNamespace } from "@codemirror/lang-sql";
import { useTabActive } from "../../shell/TabContext";
import { useLocalState } from "../../shared/useLocalState";
import { errorText } from "../../k8s/api";
import { db } from "../api";
import { displayName } from "../logic/connections";
import type { Connection, SessionInfo, TableInfo } from "../types";
import { QueryTab } from "./QueryTab";
import { SchemaPanel } from "./SchemaPanel";
import { TableTab } from "./TableTab";

type EditorTab = { id: string; kind: "table"; table: string } | { id: string; kind: "query"; title: string; sql: string };

const randomId = () => Math.random().toString(36).slice(2);
const newQuery = (n: number): EditorTab => ({ id: randomId(), kind: "query", title: `Query ${n}`, sql: "" });

export function DbEditor({ connection, session }: { connection: Connection; session: SessionInfo }) {
  const tabActive = useTabActive();
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<SQLNamespace | undefined>(undefined);
  const [tabs, setTabs] = useLocalState<EditorTab[]>(`db.editor.${connection.id}`, [newQuery(1)]);
  const [activeId, setActiveId] = useLocalState<string>(`db.editor.${connection.id}.active`, tabs[0]?.id ?? "");
  const envNames = [connection.env];
  const name = displayName(connection);

  const loadTables = useCallback(() => {
    setLoading(true);
    setError(null);
    db.tables(session.connection_id)
      .then(setTables)
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
    db.completion(session.connection_id)
      .then((map) => setSchema(map))
      .catch(() => setSchema(undefined));
  }, [session.connection_id]);

  useEffect(loadTables, [loadTables]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const openTable = (table: string) => {
    const existing = tabs.find((t) => t.kind === "table" && t.table === table);
    if (existing) return setActiveId(existing.id);
    const tab: EditorTab = { id: randomId(), kind: "table", table };
    setTabs([...tabs, tab]);
    setActiveId(tab.id);
  };

  const addQuery = useCallback(() => {
    const tab = newQuery(tabs.filter((t) => t.kind === "query").length + 1);
    setTabs([...tabs, tab]);
    setActiveId(tab.id);
  }, [tabs, setTabs, setActiveId]);

  const close = (id: string) => {
    const index = tabs.findIndex((t) => t.id === id);
    const rest = tabs.filter((t) => t.id !== id);
    const next = rest.length ? rest : [newQuery(1)];
    setTabs(next);
    if (id === active?.id) setActiveId(next[Math.max(0, index - 1)]?.id ?? next[0].id);
  };

  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        addQuery();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabActive, addQuery]);

  const views = useMemo(() => new Set(tables.filter((t) => t.kind === "view").map((t) => t.name)), [tables]);

  return (
    <div className="flex h-full min-h-0">
      <SchemaPanel
        database={session.database}
        tables={tables}
        loading={loading}
        error={error}
        activeTable={active?.kind === "table" ? active.table : null}
        onOpen={openTable}
        onNewQuery={addQuery}
        onReload={loadTables}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-end gap-0.5 overflow-x-auto border-b border-[var(--line)] px-2 pt-1.5">
          {tabs.map((t) => (
            <div
              key={t.id}
              onMouseDown={(e) => (e.button === 1 ? close(t.id) : setActiveId(t.id))}
              className={`group flex max-w-[200px] cursor-default items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1 text-[12px] ${
                t.id === active?.id ? "border-[var(--line)] bg-[var(--panel-2)] text-slate-100" : "border-transparent text-slate-500 hover:text-slate-300"
              }`}
            >
              <span className={t.kind === "table" ? "text-amber-300/80" : "text-sky-300"}>{t.kind === "table" ? "▦" : "›_"}</span>
              <span className="num truncate">{t.kind === "table" ? t.table : t.title}</span>
              <button
                className="text-slate-600 opacity-0 group-hover:opacity-100 hover:text-slate-200"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => close(t.id)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
          ))}
          <button className="mb-0.5 px-2 text-slate-500 hover:text-slate-200" onClick={addQuery} title="New SQL query (⌘N)">
            +
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {active?.kind === "table" ? (
            <TableTab key={active.id} session={session} envNames={envNames} connectionName={name} table={active.table} isView={views.has(active.table)} />
          ) : active ? (
            <QueryTab
              key={active.id}
              session={session}
              connectionName={name}
              envNames={envNames}
              sql={active.sql}
              schema={schema}
              onSql={(sql) => setTabs(tabs.map((t) => (t.id === active.id && t.kind === "query" ? { ...t, sql } : t)))}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
