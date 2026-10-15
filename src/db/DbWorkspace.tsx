// Database workspace. Opens on the connection search (grouped by client);
// picking a connection connects it (secret → relay pod → tunnel → MySQL) and
// shows the editor. Each tab remembers its own connection.

import { useLocalState } from "../shared/useLocalState";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSwitcher } from "../shell/AppSwitcher";
import { useTabActive, useTabState, useTabTitle } from "../shell/TabContext";
import { useConfirm } from "../shared/confirm/ConfirmProvider";
import { envTier } from "../shared/envKind";
import { IconSearch } from "../shared/icons";
import { ConnBadge } from "./components/ConnBadge";
import { ConnectionForm } from "./components/ConnectionForm";
import { PromptDialog } from "./components/PromptDialog";
import { useConnections } from "./hooks/useConnections";
import { useSessions } from "./hooks/useSessions";
import { displayName, draftConnection, filterGroups, isLocal, newId, nextFreePort, targetChips } from "./logic/connections";
import type { Connection, Folder } from "./types";
import { ConnectionHome } from "./views/ConnectionHome";
import { ConnectionPage } from "./views/ConnectionPage";
import { DbEditor } from "./editor/DbEditor";

type Dialog =
  | { kind: "connection"; connection: Connection; isNew: boolean }
  | { kind: "folder"; folder: Folder | null }
  | { kind: "relay" }
  | null;

export function DbWorkspace() {
  const { file, loaded, error, setError, save } = useConnections();
  const tabActive = useTabActive();
  const { sessions, progress, ended, connect, cancel, disconnect } = useSessions(tabActive);
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useTabState<string | null>("db.connection", null);
  const [searching, setSearching] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  // Client folders folded away in the side menu (the one holding the open
  // connection always stays expanded).
  const [collapsed, setCollapsed] = useLocalState<string[]>("db.collapsedFolders", []);
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);
  const [filter, setFilter] = useState("");
  const filtering = filter.trim().length > 0;
  const groups = useMemo(() => filterGroups(file, filter), [file, filter]);
  const toggleFolder = (id: string) => setCollapsed(collapsedSet.has(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);

  const selected = file.connections.find((c) => c.id === selectedId) ?? null;
  const folderName = useMemo(() => new Map(file.folders.map((f) => [f.id, f.name])), [file.folders]);
  useTabTitle(selected ? { label: displayName(selected), tier: envTier(isLocal(selected) ? "latest" : selected.env) } : null);

  // Every connect is confirmed: a stray click in the list must never open a
  // tunnel on its own. Production gets the red dialog with Cancel focused.
  const confirmConnect = useCallback(
    (c: Connection) => {
      return confirm({
        title: `Connect to ${displayName(c)}`,
        target: targetChips(c),
        envNames: isLocal(c) ? [] : [c.env],
        detail: isLocal(c) ? undefined : (
          <p className="text-[12px] text-slate-400">This starts a small relay pod in the namespace and removes it when you disconnect.</p>
        ),
        confirmLabel: "Connect",
      });
    },
    [confirm],
  );

  const startConnect = useCallback(
    async (c: Connection) => {
      if (await confirmConnect(c)) await connect(c.id);
    },
    [confirmConnect, connect],
  );

  // Open connections (or ones already connecting) are shown at once; any
  // other is selected only once the connect is confirmed.
  const open = useCallback(
    async (c: Connection) => {
      if (sessions[c.id] || progress[c.id]?.busy) {
        setSelectedId(c.id);
        setSearching(false);
        return;
      }
      if (!(await confirmConnect(c))) return;
      setSelectedId(c.id);
      setSearching(false);
      await connect(c.id);
    },
    [sessions, progress, setSelectedId, confirmConnect, connect],
  );

  useEffect(() => {
    if (!tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "e")) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tabActive]);

  async function saveConnection(c: Connection, newFolderName: string | null): Promise<boolean> {
    let folders = file.folders;
    let conn = c;
    if (newFolderName) {
      const folder = { id: newId(), name: newFolderName };
      folders = [...folders, folder];
      conn = { ...c, folder_id: folder.id };
    }
    const exists = file.connections.some((x) => x.id === conn.id);
    const connections = exists ? file.connections.map((x) => (x.id === conn.id ? conn : x)) : [...file.connections, conn];
    return save({ ...file, folders, connections });
  }

  async function removeConnection(c: Connection) {
    const ok = await confirm({
      title: `Delete the saved connection ${displayName(c)}`,
      target: [{ label: "folder", value: folderName.get(c.folder_id) ?? "" }],
      destructive: true,
      confirmLabel: "Delete",
      detail: <p className="text-[12px] text-slate-400">Only the saved shortcut is removed; nothing changes in the cluster or the database.</p>,
    });
    if (!ok) return;
    if (sessions[c.id]) await disconnect(c.id);
    if (selectedId === c.id) setSelectedId(null);
    await save({ ...file, connections: file.connections.filter((x) => x.id !== c.id) });
  }

  async function removeFolder(f: Folder) {
    const inside = file.connections.filter((c) => c.folder_id === f.id);
    const ok = await confirm({
      title: `Delete the folder ${f.name}`,
      target: [{ label: "connections", value: String(inside.length) }],
      destructive: true,
      confirmLabel: "Delete",
      detail: inside.length ? <p className="text-[12px] text-slate-400">Its {inside.length} saved connections are removed too.</p> : undefined,
    });
    if (!ok) return;
    // Close their tunnels first so no relay pod is left behind.
    await Promise.all(inside.filter((c) => sessions[c.id]).map((c) => disconnect(c.id)));
    if (inside.some((c) => c.id === selectedId)) setSelectedId(null);
    await save({ ...file, folders: file.folders.filter((x) => x.id !== f.id), connections: file.connections.filter((c) => c.folder_id !== f.id) });
  }

  function addConnection(folder: Folder | null) {
    setError(null);
    const target = folder ?? [...file.folders].sort((a, b) => a.name.localeCompare(b.name))[0] ?? { id: "", name: "" };
    setDialog({ kind: "connection", connection: draftConnection(file, target), isNew: true });
  }

  const home = (
    <ConnectionHome
      file={file}
      loaded={loaded}
      sessions={sessions}
      onOpen={(c) => void open(c)}
      onAdd={addConnection}
      onEdit={(c) => {
        setError(null);
        setDialog({ kind: "connection", connection: c, isNew: false });
      }}
      onDuplicate={(c) => {
        setError(null);
        // A copy gets its own tunnel port; a local database keeps its port.
        const port = isLocal(c) ? c.local_port : nextFreePort(file);
        setDialog({ kind: "connection", connection: { ...c, id: newId(), name: "", local_port: port }, isNew: true });
      }}
      onDelete={(c) => void removeConnection(c)}
      onNewFolder={() => setDialog({ kind: "folder", folder: null })}
      onRenameFolder={(f) => setDialog({ kind: "folder", folder: f })}
      onDeleteFolder={(f) => void removeFolder(f)}
      onClose={selected ? () => setSearching(false) : undefined}
    />
  );

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="glass flex w-64 shrink-0 flex-col border-y-0 border-l-0 px-3 py-4">
        <div className="mb-4">
          <AppSwitcher title="Database" subtitle="Connections" />
        </div>
        <div className="mb-3 flex items-center gap-1.5">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--line-soft)] px-2 py-1 focus-within:border-amber-300/50">
            <IconSearch size={12} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setFilter("")}
              placeholder="Filter connections"
              aria-label="Filter connections"
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-600"
            />
            {filtering && (
              <button className="text-[11px] text-slate-500 hover:text-slate-200" onClick={() => setFilter("")} title="Clear (esc)">
                ×
              </button>
            )}
          </label>
          <button className="btn px-2 py-1 text-xs" onClick={() => (selected ? setSearching(true) : setSelectedId(null))} title="All connections (⌘K)">
            ⌘K
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtering && groups.length === 0 && <p className="px-2 py-3 text-[11.5px] text-slate-500">No connection matches “{filter.trim()}”.</p>}
          {groups.map((g) => {
            const expanded = filtering || !collapsedSet.has(g.folder.id) || g.connections.some((c) => c.id === selectedId);
            return (
            <div key={g.folder.id} className="mb-1.5">
              <div className="group flex items-center rounded-lg px-1 py-0.5 hover:bg-[var(--line-soft)]">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left"
                  onClick={() => toggleFolder(g.folder.id)}
                  aria-expanded={expanded}
                  title={expanded ? "Collapse" : "Expand"}
                >
                  <span className={`inline-block w-3 text-[10px] text-slate-500 transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
                  <span className="label truncate">{g.folder.name}</span>
                  <span className="num ml-1 text-[10px] text-slate-600">{g.connections.length}</span>
                  {g.connections.some((c) => sessions[c.id]) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="A connection here is open" />}
                </button>
                <button className="px-1 text-[13px] text-slate-600 opacity-0 group-hover:opacity-100 hover:text-amber-300" title={`Add a connection to ${g.folder.name}`} onClick={() => addConnection(g.folder)}>
                  +
                </button>
              </div>
              {expanded && g.connections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => void open(c)}
                  className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 pl-5 text-left text-[12.5px] ${
                    c.id === selectedId ? "bg-[var(--line)] text-slate-50 shadow-[inset_2px_0_0_#fbbf24]" : "text-slate-400 hover:bg-[var(--line-soft)] hover:text-slate-200"
                  }`}
                >
                  <ConnBadge connection={c} />
                  <span className="num min-w-0 flex-1 truncate">{displayName(c)}</span>
                  {sessions[c.id] && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" title="Connected" />}
                  {progress[c.id]?.busy && <span className="h-2.5 w-2.5 animate-spin rounded-full border border-amber-300 border-t-transparent" />}
                </button>
              ))}
            </div>
            );
          })}
        </div>
        <button
          className="mt-3 truncate px-1 text-left text-[10.5px] text-slate-600 hover:text-slate-300"
          onClick={() => setDialog({ kind: "relay" })}
          title="Name of the relay pod created in each namespace"
        >
          Relay pod: <span className="num">{file.relay_pod || "socat-<your mac user>"}</span> ✎
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="btn justify-center text-xs" onClick={() => addConnection(null)}>
            + Connection
          </button>
          <button className="btn justify-center text-xs" onClick={() => setDialog({ kind: "folder", folder: null })}>
            + Folder
          </button>
        </div>
      </nav>

      <main className="relative min-w-0 flex-1">
        {error && !dialog && (
          <p className="absolute top-3 right-4 left-4 z-30 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-300" onClick={() => setError(null)}>
            {error}
          </p>
        )}
        {!selected ? (
          home
        ) : (
          <>
            <ConnectionPage
              connection={selected}
              folderName={folderName.get(selected.folder_id) ?? ""}
              session={sessions[selected.id]}
              progress={progress[selected.id]}
              ended={ended[selected.id]}
              onConnect={() => void startConnect(selected)}
              onCancel={() => cancel(selected.id)}
              onDisconnect={() => void disconnect(selected.id)}
              onEdit={() => setDialog({ kind: "connection", connection: selected, isNew: false })}
              onUsePort={(port) => {
                const updated = { ...selected, local_port: port };
                void saveConnection(updated, null).then((ok) => {
                  if (ok) void startConnect(updated);
                });
              }}
            >
              {sessions[selected.id] && <DbEditor key={selected.id} connection={selected} session={sessions[selected.id]} />}
            </ConnectionPage>
            {searching && (
              <div className="absolute inset-0 z-40 bg-[var(--bg)]/90 backdrop-blur-md" onClick={() => setSearching(false)}>
                <div className="h-full" onClick={(e) => e.stopPropagation()}>
                  {home}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {dialog?.kind === "connection" && (
        <ConnectionForm
          file={file}
          initial={dialog.connection}
          isNew={dialog.isNew}
          error={error}
          onSave={saveConnection}
          onClose={() => {
            setDialog(null);
            setError(null);
          }}
        />
      )}
      {dialog?.kind === "relay" && (
        <PromptDialog
          title="Relay pod name"
          label="Pod created in each namespace to reach the database (empty = socat-<your mac user>)"
          initial={file.relay_pod}
          onClose={() => setDialog(null)}
          onSubmit={(name) => void save({ ...file, relay_pod: name.toLowerCase() }).then((ok) => ok && setDialog(null))}
        />
      )}
      {dialog?.kind === "folder" && (
        <PromptDialog
          title={dialog.folder ? "Rename folder" : "New client folder"}
          label="Client name"
          initial={dialog.folder?.name}
          confirmLabel={dialog.folder ? "Rename" : "Create"}
          onClose={() => setDialog(null)}
          onSubmit={(name) => {
            const f = dialog.folder;
            const folders = f ? file.folders.map((x) => (x.id === f.id ? { ...x, name } : x)) : [...file.folders, { id: newId(), name }];
            void save({ ...file, folders }).then(() => setDialog(null));
          }}
        />
      )}
    </div>
  );
}
