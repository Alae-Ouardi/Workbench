// Database entry point, like the Kubernetes one: search every saved
// connection, or browse them grouped by client folder. Enter or a click opens
// (and connects) it.

import { useEffect, useMemo, useRef, useState } from "react";
import { IconDatabase, IconSearch } from "../../shared/icons";
import { ConnBadge } from "../components/ConnBadge";
import { displayName, groupByFolder, searchConnections, targetLine } from "../logic/connections";
import type { Connection, ConnectionsFile, Folder, SessionInfo } from "../types";

interface Props {
  file: ConnectionsFile;
  loaded: boolean;
  sessions: Record<string, SessionInfo>;
  onOpen: (c: Connection) => void;
  onAdd: (folder: Folder | null) => void;
  onEdit: (c: Connection) => void;
  onDuplicate: (c: Connection) => void;
  onDelete: (c: Connection) => void;
  onNewFolder: () => void;
  onRenameFolder: (f: Folder) => void;
  onDeleteFolder: (f: Folder) => void;
  onClose?: () => void;
}

export function ConnectionHome(props: Props) {
  const { file, loaded, sessions, onOpen, onAdd, onNewFolder, onClose } = props;
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const results = useMemo(() => (query.trim() ? searchConnections(file, query) : []), [file, query]);
  const groups = useMemo(() => groupByFolder(file), [file]);
  const folderName = useMemo(() => new Map(file.folders.map((f) => [f.id, f.name])), [file.folders]);
  const open = Object.values(sessions);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && results[cursor]) {
      e.preventDefault();
      onOpen(results[cursor]);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else onClose?.();
    }
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 pt-[7vh] pb-6">
      <div className="animate-rise mb-6 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-amber-300" style={{ background: "#fbbf241a", boxShadow: "inset 0 0 0 1px #fbbf2440" }}>
          <IconDatabase size={24} />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Which database?</h1>
        <p className="mt-1.5 text-xs text-slate-500">
          {file.connections.length} connections in {file.folders.length} client folders — try <span className="num text-slate-300">review acme</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="glass-strong neon-ring flex flex-1 items-center gap-3 rounded-2xl px-4 py-3.5">
          <IconSearch size={18} className="text-amber-300" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Client, environment, port…"
            className="bare-input flex-1 bg-transparent text-[15px] text-slate-100 outline-none placeholder:text-slate-600"
          />
          {onClose && <kbd className="chip num">esc</kbd>}
        </div>
        <button className="btn btn-primary h-[50px] px-4" onClick={() => onAdd(null)}>
          + Connection
        </button>
        <button className="btn h-[50px] px-4" onClick={onNewFolder}>
          + Folder
        </button>
      </div>

      <div ref={listRef} className="mt-5 min-h-0 flex-1 overflow-y-auto pb-4">
        {query.trim() ? (
          results.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">No connection matches “{query}”.</p>
          ) : (
            <div className="space-y-1">
              {results.map((c, i) => (
                <Row key={c.id} c={c} folder={folderName.get(c.folder_id)} session={sessions[c.id]} active={i === cursor} index={i} onHover={() => setCursor(i)} {...props} />
              ))}
            </div>
          )
        ) : !loaded ? null : file.connections.length === 0 && file.folders.length === 0 ? (
          <div className="glass mx-auto mt-6 max-w-md rounded-2xl p-8 text-center">
            <p className="text-sm font-medium text-slate-200">No connections yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Create a folder per client, then a connection per environment (latest, review, prod…). Each one opens the tunnel and the editor in one click.
            </p>
            <button className="btn btn-primary mt-5" onClick={() => onAdd(null)}>
              + Add your first connection
            </button>
          </div>
        ) : (
          <>
            {open.length > 0 && (
              <section className="mb-5">
                <div className="label mb-2 px-1">Connected</div>
                <div className="space-y-1">
                  {open.map((s) => {
                    const c = file.connections.find((x) => x.id === s.connection_id);
                    return c ? <Row key={c.id} c={c} folder={folderName.get(c.folder_id)} session={s} {...props} /> : null;
                  })}
                </div>
              </section>
            )}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {groups.map((g) => (
                <FolderCard key={g.folder.id} folder={g.folder} connections={g.connections} {...props} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FolderCard({ folder, connections, sessions, onAdd, onRenameFolder, onDeleteFolder, ...rest }: Props & { folder: Folder; connections: Connection[] }) {
  return (
    <section className="glass animate-rise rounded-2xl p-3">
      <header className="group mb-2 flex items-center gap-2 px-1">
        <span className="text-[13.5px] font-semibold text-slate-100">{folder.name}</span>
        <span className="num text-[11px] text-slate-600">{connections.length}</span>
        <button className="rounded-lg px-2 py-0.5 text-[11.5px] text-amber-300 hover:bg-[var(--line-soft)]" onClick={() => onAdd(folder)} title="Add a connection to this client">
          + Add
        </button>
        {/* Shown on hover, on the right, without moving + Add. */}
        <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button className="rounded px-1.5 text-[11px] text-slate-500 hover:text-slate-200" onClick={() => onRenameFolder(folder)}>
            Rename
          </button>
          <button className="rounded px-1.5 text-[11px] text-slate-500 hover:text-rose-300" onClick={() => onDeleteFolder(folder)}>
            Delete
          </button>
        </span>
      </header>
      {connections.length === 0 && <p className="px-1 py-3 text-[11.5px] text-slate-600">No connections yet.</p>}
      <div className="space-y-0.5">
        {connections.map((c) => (
          <Row key={c.id} c={c} session={sessions[c.id]} sessions={sessions} onAdd={onAdd} onRenameFolder={onRenameFolder} onDeleteFolder={onDeleteFolder} {...rest} compact />
        ))}
      </div>
    </section>
  );
}

function Row({
  c,
  folder,
  session,
  active,
  index,
  onHover,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  compact,
}: Props & {
  c: Connection;
  folder?: string;
  session?: SessionInfo;
  active?: boolean;
  index?: number;
  onHover?: () => void;
  compact?: boolean;
}) {
  const where = targetLine(c);
  return (
    <div
      data-row={index}
      onMouseEnter={onHover}
      onClick={() => onOpen(c)}
      className={`group flex cursor-pointer items-center gap-3 rounded-xl border px-3 ${compact ? "py-2" : "py-2.5"} transition-colors ${
        active ? "border-[var(--line-strong)] bg-[var(--line)]" : "border-transparent hover:bg-[var(--line-soft)]"
      }`}
    >
      <ConnBadge connection={c} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="num truncate text-[13px] font-medium text-slate-100">{displayName(c)}</span>
          {folder && <span className="truncate text-[11px] text-slate-500">{folder}</span>}
        </div>
        <div className="num truncate text-[10.5px] text-slate-500" title={where}>
          {where}
        </div>
      </div>
      <span className="num text-[11px] text-slate-500">:{c.local_port}</span>
      <span className="hidden gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
        <button className="rounded px-1.5 text-[11px] text-slate-500 hover:text-slate-200" onClick={() => onEdit(c)}>
          Edit
        </button>
        <button className="rounded px-1.5 text-[11px] text-slate-500 hover:text-slate-200" onClick={() => onDuplicate(c)}>
          Copy
        </button>
        <button className="rounded px-1.5 text-[11px] text-slate-500 hover:text-rose-300" onClick={() => onDelete(c)}>
          Delete
        </button>
      </span>
      {session ? (
        <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> Open
        </span>
      ) : (
        <span className="rounded-lg border border-[var(--line)] px-2 py-0.5 text-[11px] text-slate-400 group-hover:border-amber-400/50 group-hover:text-amber-200">Connect</span>
      )}
    </div>
  );
}
