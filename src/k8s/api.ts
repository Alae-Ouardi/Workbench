import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ContextInfo, ForwardInfo, K8sObject, LogOptions, ResourceKind, Usage, WatchEvent } from "./types";

type Scope = { context: string; namespace: string };
type Target = Scope & { kind: ResourceKind; name: string };

export const k8s = {
  contexts: () => invoke<ContextInfo[]>("k8s_contexts"),
  namespaces: (context: string) => invoke<string[]>("k8s_namespaces", { context }),
  list: (s: Scope, kind: ResourceKind) => invoke<K8sObject[]>("k8s_list", { ...s, kind }),
  get: (t: Target) => invoke<K8sObject>("k8s_get", t),
  yaml: (t: Target) => invoke<string>("k8s_get_yaml", t),
  describe: (t: Target) => invoke<string>("k8s_describe", t),
  eventsFor: (s: Scope, name: string) => invoke<K8sObject[]>("k8s_events_for", { ...s, name }),
  top: (s: Scope, kind: "pods" | "nodes") => invoke<Usage[]>("k8s_top", { ...s, kind }),
  secretValue: (s: Scope, name: string, key: string) => invoke<string>("k8s_secret_value", { ...s, name, key }),
  remove: (t: Target) => invoke<string>("k8s_delete", t),
  scale: (t: Target, replicas: number) => invoke<string>("k8s_scale", { ...t, replicas }),
  restart: (t: Target) => invoke<string>("k8s_rollout_restart", t),
  replaceYaml: (s: Scope, yaml: string, dryRun: boolean) => invoke<string>("k8s_replace_yaml", { ...s, yaml, dryRun }),
  watchStart: (s: Scope, kind: ResourceKind) => invoke<number>("k8s_watch_start", { ...s, kind }),
  watchStop: (watchId: number) => invoke<void>("k8s_watch_stop", { watchId }),
  logsStart: (s: Scope, pod: string, options: LogOptions) => invoke<number>("k8s_logs_start", { ...s, pod, options }),
  procKill: (id: number) => invoke<void>("proc_kill", { id }),
  forwardStart: (s: Scope, target: string, localPort: number, remotePort: number) =>
    invoke<ForwardInfo>("k8s_forward_start", { ...s, target, localPort, remotePort }),
  forwardStop: (id: number) => invoke<void>("k8s_forward_stop", { id }),
  forwards: () => invoke<ForwardInfo[]>("k8s_forward_list"),
  exec: (s: Scope, pod: string, container: string, cols: number, rows: number) =>
    invoke<number>("k8s_exec", { ...s, pod, container, cols, rows }),
};

export function onWatch(cb: (watchId: number, events: WatchEvent[]) => void): Promise<UnlistenFn> {
  return listen<{ watch_id: number; events: WatchEvent[] }>("k8s-watch", (e) => cb(e.payload.watch_id, e.payload.events));
}

export function onWatchEnd(cb: (watchId: number, error: string | null) => void): Promise<UnlistenFn> {
  return listen<{ watch_id: number; error: string | null }>("k8s-watch-end", (e) => cb(e.payload.watch_id, e.payload.error));
}

export function onLogLine(cb: (id: number, line: string) => void): Promise<UnlistenFn> {
  return listen<{ id: number; line: string }>("k8s-log", (e) => cb(e.payload.id, e.payload.line));
}

export function onProcExit(cb: (id: number, error: string | null) => void): Promise<UnlistenFn> {
  return listen<{ id: number; code: number | null; stderr: string; killed: boolean }>("proc-exit", (e) =>
    cb(e.payload.id, e.payload.killed || e.payload.code === 0 ? null : e.payload.stderr || "stopped"),
  );
}

export function onForwardEnd(cb: (id: number, error: string | null) => void): Promise<UnlistenFn> {
  return listen<{ id: number; error: string | null }>("k8s-forward-end", (e) => cb(e.payload.id, e.payload.error));
}

export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}
