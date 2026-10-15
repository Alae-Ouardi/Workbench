// SQL editor: ⌘↵ runs the selection (or everything), with schema-aware
// completion, cancel, results per statement, and a history. Anything that
// changes data asks for confirmation first, showing the statement.

import { useRef, useState } from "react";
import type { SQLNamespace } from "@codemirror/lang-sql";
import { useConfirm } from "../../shared/confirm/ConfirmProvider";
import { CodeEditor, type CodeEditorHandle } from "../../shared/editor/CodeEditor";
import { useLocalState } from "../../shared/useLocalState";
import { errorText } from "../../k8s/api";
import { db } from "../api";
import { isReadOnlySql } from "../logic/export";
import type { ResultSet, SessionInfo } from "../types";
import { ExportMenu, ResultsGrid } from "./ResultsGrid";

const HISTORY_MAX = 200;
/** Long statements (bulk inserts) are kept only in part. */
const HISTORY_SQL_MAX = 4000;

export interface HistoryEntry {
  sql: string;
  at: string;
  ms: number;
  ok: boolean;
}

export function QueryTab({
  session,
  connectionName,
  envNames,
  sql,
  onSql,
  schema,
}: {
  session: SessionInfo;
  connectionName: string;
  envNames: string[];
  sql: string;
  onSql: (sql: string) => void;
  schema: SQLNamespace | undefined;
}) {
  const confirm = useConfirm();
  const editor = useRef<CodeEditorHandle>(null);
  const [results, setResults] = useState<ResultSet[] | null>(null);
  const [active, setActive] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useLocalState<HistoryEntry[]>(`db.history.${session.connection_id}`, []);

  async function run() {
    const text = (editor.current?.selectionOrAll() ?? sql).trim();
    if (!text || running) return;
    const readOnly = isReadOnlySql(text);
    if (!readOnly) {
      const ok = await confirm({
        title: "Run a statement that changes data",
        target: [
          { label: "connection", value: connectionName },
          { label: "database", value: session.database },
        ],
        envNames,
        destructive: /\b(delete|drop|truncate|alter)\b/i.test(text),
        confirmLabel: "Run",
        detail: (
          <pre className="num max-h-64 overflow-auto rounded-lg bg-[var(--bg)] p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300">{text}</pre>
        ),
      });
      if (!ok) return;
    }
    const queryId = Math.random().toString(36).slice(2);
    setRunning(queryId);
    setError(null);
    const started = performance.now();
    try {
      const sets = await db.query(session.connection_id, queryId, text, !readOnly);
      setResults(sets);
      setActive(Math.max(0, sets.findIndex((s) => s.columns.length > 0)));
      record(text, started, true);
    } catch (e) {
      setError(errorText(e));
      setResults(null);
      record(text, started, false);
    } finally {
      setRunning(null);
    }
  }

  function record(text: string, started: number, ok: boolean) {
    const entry = { sql: text.length > HISTORY_SQL_MAX ? `${text.slice(0, HISTORY_SQL_MAX)}…` : text, at: new Date().toISOString(), ms: Math.round(performance.now() - started), ok };
    setHistory([entry, ...history.filter((h) => h.sql !== text)].slice(0, HISTORY_MAX));
  }

  const current = results?.[active];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[38%] min-h-[120px] border-b border-[var(--line)]">
          <CodeEditor
            ref={editor}
            value={sql}
            language="sql"
            schema={schema}
            onChange={onSql}
            onRun={() => void run()}
            placeholder="SELECT * FROM … — ⌘↵ runs the selection or everything"
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <button className="btn btn-primary py-1 text-xs" onClick={() => void run()} disabled={!!running}>
            {running ? "Running…" : "Run ⌘↵"}
          </button>
          {running && (
            <button className="btn py-1 text-xs text-rose-300" onClick={() => void db.cancel(running)}>
              Cancel
            </button>
          )}
          {results && results.length > 1 && (
            <div className="flex gap-1">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => setActive(i)}
                  className={`rounded-md px-2 py-0.5 text-[11px] ${i === active ? "bg-[var(--line)] text-slate-50" : "text-slate-500"}`}
                >
                  Result {i + 1}
                  {r.columns.length ? ` · ${r.rows.length}` : ""}
                </button>
              ))}
            </div>
          )}
          {current && (
            <span className="num text-[11px] text-slate-500">
              {current.columns.length
                ? `${current.rows.length.toLocaleString()} rows${current.truncated ? " (first 5,000)" : ""}`
                : `${current.affected_rows} rows affected${current.last_insert_id ? ` · last id ${current.last_insert_id}` : ""}`}{" "}
              · {current.elapsed_ms} ms
            </span>
          )}
          <span className="ml-auto flex gap-2">
            {current && <ExportMenu columns={current.columns} rows={current.rows} table={current.columns[0]?.table ?? ""} />}
            <button className={`btn py-1 text-xs ${showHistory ? "border-[var(--line-strong)]" : ""}`} onClick={() => setShowHistory(!showHistory)}>
              History
            </button>
          </span>
        </div>
        {error && <p className="num mx-3 mb-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[12px] whitespace-pre-wrap text-rose-300">{error}</p>}
        <div className="min-h-0 flex-1 px-3 pb-3">
          {current && current.columns.length > 0 ? (
            <ResultsGrid columns={current.columns} rows={current.rows} />
          ) : (
            <p className="py-8 text-center text-xs text-slate-600">{current ? current.info || "Done." : "Results appear here."}</p>
          )}
        </div>
      </div>
      {showHistory && (
        <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--line)]">
          <div className="flex items-center px-3 py-2">
            <span className="label">History</span>
            <button className="ml-auto text-[11px] text-slate-500 hover:text-rose-300" onClick={() => setHistory([])}>
              Clear
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {history.length === 0 && <p className="px-1 text-[11px] text-slate-600">Queries you run show up here.</p>}
            {history.map((h) => (
              <button
                key={h.at}
                onClick={() => onSql(h.sql)}
                title="Put this query in the editor"
                className="mb-1 block w-full rounded-lg border border-transparent px-2 py-1.5 text-left hover:border-[var(--line)] hover:bg-[var(--line-soft)]"
              >
                <div className="num line-clamp-3 text-[11px] break-all text-slate-300">{h.sql}</div>
                <div className={`mt-0.5 text-[10px] ${h.ok ? "text-slate-600" : "text-rose-400/80"}`}>
                  {new Date(h.at).toLocaleString()} · {h.ms} ms{h.ok ? "" : " · failed"}
                </div>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}
