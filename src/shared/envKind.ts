// Which environment tier a cluster context, namespace or connection belongs
// to. Drives the colour badges and how loudly a change is confirmed.

export type EnvTier = "prod" | "preprod" | "uat" | "review" | "latest" | "other";

// Most severe first.
const TIERS: { tier: EnvTier; pattern: RegExp }[] = [
  { tier: "prod", pattern: /(^|[.\-_])(prod(uction)?\d*|prd\d*)([.\-_]|$)/i },
  { tier: "preprod", pattern: /(^|[.\-_])pre-?prod(uction)?\d*([.\-_]|$)/i },
  { tier: "uat", pattern: /(^|[.\-_])(uat|staging|stage)([.\-_]|$)/i },
  { tier: "review", pattern: /(^|[.\-_])review([.\-_]|$)/i },
  { tier: "latest", pattern: /(^|[.\-_])(latest|integration|dev)([.\-_]|$)/i },
];

/**
 * The most severe tier any of the names shows: a "review-x" namespace on a
 * prod cluster is prod, so the red warning can't be missed.
 */
export function envTier(...names: (string | undefined | null)[]): EnvTier {
  const all = names.filter((n): n is string => Boolean(n));
  return TIERS.find((t) => all.some((n) => t.pattern.test(n)))?.tier ?? "other";
}

/** Production-like: changes here get the red warning. */
export function isProdLike(tier: EnvTier): boolean {
  return tier === "prod" || tier === "preprod";
}

export const TIER_STYLE: Record<EnvTier, { label: string; color: string }> = {
  prod: { label: "PROD", color: "#fb7185" },
  preprod: { label: "PREPROD", color: "#fb923c" },
  uat: { label: "UAT", color: "#fbbf24" },
  review: { label: "REVIEW", color: "#a78bfa" },
  latest: { label: "LATEST", color: "#34d399" },
  other: { label: "ENV", color: "#94a3b8" },
};
