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
  return c.name.trim() || `${c.env}-${c.client}`;
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

/** Every word must match the folder, name, env, client, namespace or port. */
export function searchConnections(file: ConnectionsFile, query: string): Connection[] {
  const words = query.trim().toLowerCase().split(/[\s/]+/).filter(Boolean);
  const folders = new Map(file.folders.map((f) => [f.id, f.name.toLowerCase()]));
  const hits = file.connections.filter((c) => {
    const { context, namespace } = resolveTarget(c);
    const hay = `${folders.get(c.folder_id) ?? ""} ${displayName(c)} ${c.env} ${c.client} ${namespace} ${context} ${c.local_port}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return hits.sort((a, b) => {
    const exact = (c: Connection) => (resolveTarget(c).namespace === words.join("-") ? 0 : 1);
    return exact(a) - exact(b) || (folders.get(a.folder_id) ?? "").localeCompare(folders.get(b.folder_id) ?? "") || ENV_ORDER[a.env] - ENV_ORDER[b.env];
  });
}

/** First free local port from 3307 up. */
export function nextFreePort(file: ConnectionsFile, start = 3307): number {
  const used = new Set(file.connections.map((c) => c.local_port));
  let port = start;
  while (used.has(port)) port += 1;
  return port;
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A blank connection in `folder`, guessing the client from the folder name. */
export function draftConnection(file: ConnectionsFile, folder: Folder, env: DbEnv = "review"): Connection {
  const client = folder.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return {
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
  };
}
