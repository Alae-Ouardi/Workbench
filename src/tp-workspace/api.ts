import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { tpGetSettings } from "../api";
import type { TpUser } from "../types";
import type { TpEntityState, TpwQuery, TpwResult, WorkspacePrefs } from "./types";

/** Live fetches in flight, so views sharing a query share one round trip. */
const inFlight = new Map<string, Promise<unknown>>();

export function tpwQuery<T>(query: TpwQuery, fresh: boolean): Promise<TpwResult<T> | null> {
  if (!fresh) return invoke("tpw_query", { query, fresh });
  const key = JSON.stringify(query);
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<TpwResult<T> | null>;
  const request = invoke<TpwResult<T> | null>("tpw_query", { query, fresh }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function tpwMe(): Promise<TpUser> {
  return invoke("tpw_me");
}

export function tpwStates(processId: number, entityType: string): Promise<TpEntityState[]> {
  return invoke("tpw_states", { processId, entityType });
}

export function tpwSetState(entityType: string, entityId: number, stateId: number): Promise<void> {
  return invoke("tpw_set_state", { entityType, entityId, stateId });
}

export async function tpwLogTime(entityId: number, hours: number, description: string, date: string): Promise<number> {
  const id = await invoke<number>("tpw_log_time", { entityId, hours, description, date });
  // Keep today's hours next to the menu-bar icon current.
  invoke("menubar_refresh").catch(() => {});
  return id;
}

export function tpwGetPrefs(): Promise<WorkspacePrefs> {
  return invoke("tpw_get_prefs");
}

export function tpwSavePrefs(prefs: WorkspacePrefs): Promise<WorkspacePrefs> {
  return invoke("tpw_save_prefs", { prefs });
}

let baseUrl: string | null = null;

/** Open an entity in the TargetProcess web app. */
export async function openInTp(entityId: number): Promise<void> {
  if (baseUrl === null) baseUrl = (await tpGetSettings()).base_url_normalized;
  if (baseUrl) await openUrl(`${baseUrl}/entity/${entityId}`);
}

export function forgetTpBaseUrl(): void {
  baseUrl = null;
}
