// Environment search: every namespace on every context is an "environment".
// Queries like "review acme" or "prod-acme" find it; the connector naming
// rules (env-client namespaces) let a typed env + client resolve even before
// the namespace lists have loaded.

import { envTier, type EnvTier } from "../../shared/envKind";
import type { EnvRef } from "../types";

export interface EnvEntry extends EnvRef {
  tier: EnvTier;
  /** Cluster context is shared by many clients (integration, shared prod). */
  sharedCluster: boolean;
}

export const ENV_PREFIXES = ["latest", "review", "uat", "preprod", "prod"] as const;

/** Namespaces that are cluster plumbing, not client environments. */
const SYSTEM_NS = /^(kube-|default$|cert-manager|ingress|monitoring|istio|linkerd|argocd|flux|velero|karpenter|external-)/;

export function envKey(env: EnvRef): string {
  return `${env.context}/${env.namespace}`;
}

export function parseEnvKey(key: string): EnvRef | null {
  const slash = key.lastIndexOf("/");
  if (slash <= 0) return null;
  return { context: key.slice(0, slash), namespace: key.slice(slash + 1) };
}

/** All environments from the namespace lists, client envs before plumbing. */
export function buildEntries(namespacesByContext: Record<string, string[]>): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const [context, namespaces] of Object.entries(namespacesByContext)) {
    const clientNs = namespaces.filter((ns) => !SYSTEM_NS.test(ns));
    const shared = clientNs.length > 3;
    for (const namespace of namespaces) {
      entries.push({ context, namespace, tier: envTier(namespace, context), sharedCluster: shared });
    }
  }
  return entries.sort((a, b) => systemRank(a) - systemRank(b) || a.namespace.localeCompare(b.namespace) || a.context.localeCompare(b.context));
}

function systemRank(e: EnvEntry): number {
  return SYSTEM_NS.test(e.namespace) ? 1 : 0;
}

/** "review acme", "review-acme", "acme review" → namespace "review-acme". */
export function namespaceGuess(query: string): string | null {
  const words = query.trim().toLowerCase().split(/[\s/]+/).filter(Boolean);
  if (words.length === 1) {
    const [env, ...rest] = words[0].split("-");
    return ENV_PREFIXES.includes(env as (typeof ENV_PREFIXES)[number]) && rest.length > 0 ? words[0] : null;
  }
  if (words.length !== 2) return null;
  const envIdx = words.findIndex((w) => ENV_PREFIXES.includes(w as (typeof ENV_PREFIXES)[number]));
  if (envIdx === -1) return null;
  return `${words[envIdx]}-${words[1 - envIdx]}`;
}

/**
 * Rank entries for a query. Exact namespace matches first (the env-client
 * guess included), then prefix, then any substring of namespace or context.
 */
export function searchEnvs(entries: EnvEntry[], query: string, limit = 80): EnvEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.filter((e) => !SYSTEM_NS.test(e.namespace)).slice(0, limit);
  const guess = namespaceGuess(q);
  const words = q.split(/[\s/]+/).filter(Boolean);
  const scored: { e: EnvEntry; score: number }[] = [];
  for (const e of entries) {
    const ns = e.namespace.toLowerCase();
    const hay = `${ns} ${e.context.toLowerCase()}`;
    let score: number;
    if (guess && ns === guess) score = 0;
    else if (ns === q) score = 0;
    else if (ns.startsWith(q.replace(/\s+/g, "-"))) score = 1;
    else if (words.every((w) => hay.includes(w))) score = ns.includes(words[0]) ? 2 : 3;
    else continue;
    scored.push({ e, score: score + (SYSTEM_NS.test(ns) ? 5 : 0) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.e.namespace.localeCompare(b.e.namespace))
    .slice(0, limit)
    .map((s) => s.e);
}

/** Group results by the client part of the namespace (acme → review-acme, prod-acme…). */
export function clientOf(namespace: string): string {
  const [env, ...rest] = namespace.split("-");
  return ENV_PREFIXES.includes(env as (typeof ENV_PREFIXES)[number]) && rest.length ? rest.join("-") : namespace;
}

/** Most-recent-first list without duplicates, capped. */
export function pushRecent(list: string[], key: string, max = 12): string[] {
  return [key, ...list.filter((k) => k !== key)].slice(0, max);
}
