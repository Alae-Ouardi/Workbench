// Pure helpers for the connection list: resolution (mirrors the Rust side and
// the connector script, for previews), grouping, search, and new defaults.

import type { Connection, ConnectionsFile, DbEnv, Folder } from "../types";

export const DEFAULT_DOMAIN = "omnevo";
export const DEFAULT_SECRET = "db-shifteo-services";

/** The shared cluster most clients without their own one use. */
export function sharedClusterContext(domain: string): string {
  return `prod.euc1.${domain.trim() || DEFAULT_DOMAIN}.cloud`;
}

/**
 * Mirrors `resolve` in src-tauri/src/db/connections.rs and the connector
 * script: an explicit context (the "Shared cluster" option) wins.
 */
export function resolveTarget(c: Pick<Connection, "env" | "client" | "cluster_domain" | "context" | "namespace">) {
  const domain = c.cluster_domain.trim() || DEFAULT_DOMAIN;
  const context =
    c.context?.trim() || (c.env === "prod" || c.env === "preprod" ? `${c.env}.${c.client}.${domain}.cloud` : `integration.${domain}.cloud`);
  const namespace = c.namespace?.trim() || `${c.env}-${c.client}`;
  return { context, namespace };
}

/** The equivalent connector-script command, shown for reassurance. */
export function scriptCommand(c: Connection): string {
  const parts = [`./omnevo-db-connector.sh ${c.env} ${c.client}`, `--port ${c.local_port}`, `--cluster-domain ${c.cluster_domain || DEFAULT_DOMAIN}`];
  if (c.context?.trim()) parts.push(`--context ${c.context.trim()}`);
  if (c.namespace?.trim()) parts.push(`--namespace ${c.namespace.trim()}`);
  return parts.join(" ");
}

export function displayName(c: Connection): string {
  if (c.name.trim()) return c.name.trim();
  return c.kind === "local" ? c.database.trim() || "local" : `${c.env}-${c.client}`;
}

export const isLocal = (c: Pick<Connection, "kind">) => c.kind === "local";

/** One line saying where a connection points. */
export function targetLine(c: Connection): string {
  if (isLocal(c)) return `${c.host.trim()}:${c.local_port}/${c.database.trim()}`;
  const { context, namespace } = resolveTarget(c);
  return `${namespace} · ${context}`;
}

/** The "where" chips of the connect confirmation. */
export function targetChips(c: Connection): { label: string; value: string }[] {
  if (isLocal(c)) {
    return [
      { label: "host", value: `${c.host.trim()}:${c.local_port}` },
      { label: "database", value: c.database.trim() },
      { label: "user", value: c.user.trim() },
    ];
  }
  const { context, namespace } = resolveTarget(c);
  return [
    { label: "cluster", value: context },
    { label: "namespace", value: namespace },
    { label: "local port", value: String(c.local_port) },
  ];
}

const ENV_ORDER: Record<DbEnv, number> = { latest: 0, review: 1, uat: 2, preprod: 3, prod: 4 };

export interface FolderGroup {
  folder: Folder;
  connections: Connection[];
}

/** Folders alphabetically, connections by environment order. */
export function groupByFolder(file: ConnectionsFile): FolderGroup[] {
  return [...file.folders]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((folder) => ({
      folder,
      connections: file.connections
        .filter((c) => c.folder_id === folder.id)
        .sort((a, b) => ENV_ORDER[a.env] - ENV_ORDER[b.env] || displayName(a).localeCompare(displayName(b))),
    }));
}

function queryWords(query: string): string[] {
  return query.trim().toLowerCase().split(/[\s/]+/).filter(Boolean);
}

function matcher(file: ConnectionsFile, words: string[]) {
  const folders = new Map(file.folders.map((f) => [f.id, f.name.toLowerCase()]));
  return (c: Connection) => {
    const where = isLocal(c) ? `local ${c.host} ${c.database} ${c.user}` : `${c.env} ${c.client} ${targetLine(c)}`;
    const hay = `${folders.get(c.folder_id) ?? ""} ${displayName(c)} ${where} ${c.local_port}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
}

/** Every word must match the folder, name, env, client, namespace or port. */
export function searchConnections(file: ConnectionsFile, query: string): Connection[] {
  const words = queryWords(query);
  const folders = new Map(file.folders.map((f) => [f.id, f.name.toLowerCase()]));
  const hits = file.connections.filter(matcher(file, words));
  return hits.sort((a, b) => {
    const exact = (c: Connection) => (!isLocal(c) && resolveTarget(c).namespace === words.join("-") ? 0 : 1);
    return exact(a) - exact(b) || (folders.get(a.folder_id) ?? "").localeCompare(folders.get(b.folder_id) ?? "") || ENV_ORDER[a.env] - ENV_ORDER[b.env];
  });
}

/** The side menu's folders keeping only matching connections; empty folders drop out. */
export function filterGroups(file: ConnectionsFile, query: string): FolderGroup[] {
  const groups = groupByFolder(file);
  const words = queryWords(query);
  if (!words.length) return groups;
  const hit = matcher(file, words);
  return groups.map((g) => ({ ...g, connections: g.connections.filter(hit) })).filter((g) => g.connections.length > 0);
}

/** First local tunnel port from 3307 up not taken by another cluster connection. */
export function nextFreePort(file: ConnectionsFile, start = 3307): number {
  const used = new Set(file.connections.filter((c) => c.kind !== "local").map((c) => c.local_port));
  let port = start;
  while (used.has(port)) port += 1;
  return port;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A blank local connection in `folder`, on the standard MySQL port. */
export function draftLocal(c: Connection): Connection {
  return { ...c, kind: "local", env: "latest", host: c.host || "127.0.0.1", local_port: 3306, user: c.user || "root" };
}

/** A blank connection in `folder`, guessing the client from the folder name. */
export function draftConnection(file: ConnectionsFile, folder: Folder, env: DbEnv = "review"): Connection {
  const client = folder.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    kind: "cluster",
    id: newId(),
    folder_id: folder.id,
    name: "",
    env,
    client,
    local_port: nextFreePort(file),
    cluster_domain: DEFAULT_DOMAIN,
    context: null,
    namespace: null,
    secret: DEFAULT_SECRET,
    host: "",
    user: "",
    database: "",
  };
}
