export type DbEnv = "latest" | "review" | "uat" | "preprod" | "prod";

export const DB_ENVS: DbEnv[] = ["latest", "review", "uat", "preprod", "prod"];

export interface Folder {
  id: string;
  name: string;
}

/** Cluster: through a relay pod. Local: reached directly (this Mac, Docker…). */
export type ConnectionKind = "cluster" | "local";

export interface Connection {
  kind: ConnectionKind;
  id: string;
  folder_id: string;
  name: string;
  env: DbEnv;
  client: string;
  /** Cluster: the tunnel's port on this Mac. Local: the database port. */
  local_port: number;
  /** Local only. */
  host: string;
  user: string;
  database: string;
  cluster_domain: string;
  context: string | null;
  namespace: string | null;
  secret: string;
}

export interface ConnectionsFile {
  folders: Folder[];
  connections: Connection[];
  relay_pod: string;
}

export interface SessionInfo {
  connection_id: string;
  context: string;
  namespace: string;
  /** 127.0.0.1 for a tunnel, else the local database host. */
  host: string;
  local_port: number;
  database: string;
  user: string;
  server_version: string;
  connected_at: string;
  expires_at: string;
}

export type StepName = "secret" | "pod" | "ready" | "forward" | "database";

export interface ConnectStep {
  connection_id: string;
  step: StepName;
  state: "running" | "done" | "error";
  detail: string;
}

export interface TableInfo {
  name: string;
  kind: "table" | "view";
  rows: number | null;
  size_bytes: number | null;
  comment: string;
}

export interface ColumnInfo {
  name: string;
  column_type: string;
  nullable: boolean;
  key: string;
  default: string | null;
  extra: string;
  comment: string;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableDetail {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
}

export type CellKind = "number" | "text" | "date" | "datetime" | "time" | "json" | "binary" | "other";

export interface ColumnMeta {
  name: string;
  kind: CellKind;
  table: string;
}

export type Cell = string | number | null;

export interface ResultSet {
  columns: ColumnMeta[];
  rows: Cell[][];
  truncated: boolean;
  affected_rows: number;
  last_insert_id: number | null;
  info: string;
  elapsed_ms: number;
}

export interface Filter {
  column: string;
  op:
    | "contains"
    | "not contains"
    | "starts with"
    | "ends with"
    | "="
    | "!="
    | "<"
    | ">"
    | "<="
    | ">="
    | "like"
    | "not like"
    | "is null"
    | "is not null";
  value: string | null;
}

export interface RowsRequest {
  table: string;
  offset: number;
  limit: number;
  sort: [string, "asc" | "desc"] | null;
  filters: Filter[];
}

export interface RowsPage {
  result: ResultSet;
  total: number;
  primary_key: string[];
}

export type RowChange =
  | { kind: "update"; key: Record<string, string | null>; values: Record<string, string | null> }
  | { kind: "insert"; values: Record<string, string | null> }
  | { kind: "delete"; key: Record<string, string | null> };
