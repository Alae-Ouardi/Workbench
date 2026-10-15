// Shapes exchanged with the Kubernetes backend. Objects are kept loose (raw
// Kubernetes JSON); the logic layer reads the fields it needs defensively.

export interface ContextInfo {
  name: string;
  cluster: string;
  namespace: string | null;
}

/** An environment = one namespace on one cluster context. */
export interface EnvRef {
  context: string;
  namespace: string;
}

export interface K8sMeta {
  name: string;
  namespace?: string;
  uid: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: { kind: string; name: string }[];
  resourceVersion?: string;
  deletionTimestamp?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type K8sObject = { kind?: string; metadata: K8sMeta; spec?: any; status?: any; data?: Record<string, string>; [key: string]: any };

export interface WatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR";
  object: K8sObject;
}

export interface Usage {
  name: string;
  cpu_m: number;
  memory: number;
}

export interface ForwardInfo {
  id: number;
  context: string;
  namespace: string;
  target: string;
  local_port: number;
  remote_port: number;
  owner: string;
  started_at: string;
}

export interface LogOptions {
  container: string | null;
  follow: boolean;
  previous: boolean;
  timestamps: boolean;
  tail: number;
}

export type ResourceKind =
  | "pods"
  | "deployments"
  | "statefulsets"
  | "daemonsets"
  | "jobs"
  | "cronjobs"
  | "services"
  | "ingresses"
  | "configmaps"
  | "secrets"
  | "persistentvolumeclaims"
  | "events"
  | "nodes";
