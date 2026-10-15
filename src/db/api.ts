import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ConnectionsFile, ConnectStep, ResultSet, RowChange, RowsPage, RowsRequest, SessionInfo, TableDetail, TableInfo } from "./types";

export const db = {
  load: () => invoke<ConnectionsFile>("db_connections_get"),
  save: (file: ConnectionsFile) => invoke<void>("db_connections_save", { file }),
  connect: (connectionId: string) => invoke<SessionInfo>("db_connect", { connectionId }),
  cancelConnect: (connectionId: string) => invoke<void>("db_cancel_connect", { connectionId }),
  setLocalPassword: (connectionId: string, password: string) => invoke<void>("db_local_password_set", { connectionId, password }),
  localPasswordSaved: (connectionId: string) => invoke<boolean>("db_local_password_saved", { connectionId }),
  disconnect: (connectionId: string) => invoke<void>("db_disconnect", { connectionId }),
  sessions: () => invoke<SessionInfo[]>("db_sessions"),
  password: (connectionId: string) => invoke<string>("db_password", { connectionId }),
  tables: (connectionId: string) => invoke<TableInfo[]>("db_tables", { connectionId }),
  tableDetail: (connectionId: string, table: string) => invoke<TableDetail>("db_table_detail", { connectionId, table }),
  completion: (connectionId: string) => invoke<Record<string, string[]>>("db_completion_schema", { connectionId }),
  rows: (connectionId: string, request: RowsRequest) => invoke<RowsPage>("db_rows", { connectionId, request }),
  query: (connectionId: string, queryId: string, sql: string, allowWrites: boolean) =>
    invoke<ResultSet[]>("db_query", { connectionId, queryId, sql, allowWrites }),
  cancel: (queryId: string) => invoke<void>("db_cancel", { queryId }),
  prepareChanges: (connectionId: string, table: string, changes: RowChange[]) =>
    invoke<{ batch_id: string; preview: string[] }>("db_prepare_changes", { connectionId, table, changes }),
  applyChanges: (connectionId: string, batchId: string) =>
    invoke<{ affected_rows: number; last_insert_ids: number[] }>("db_apply_changes", { connectionId, batchId }),
};

export function onConnectStep(cb: (step: ConnectStep) => void): Promise<UnlistenFn> {
  return listen<ConnectStep>("db-connect-step", (e) => cb(e.payload));
}

export function onSessionEnd(cb: (connectionId: string, reason: string) => void): Promise<UnlistenFn> {
  return listen<{ connection_id: string; reason: string }>("db-session-end", (e) => cb(e.payload.connection_id, e.payload.reason));
}
