import { TIER_STYLE, type EnvTier } from "./envKind";

/** Coloured tier chip: PROD in red, REVIEW in violet… */
export function EnvBadge({ tier, size = "sm" }: { tier: EnvTier; size?: "sm" | "md" }) {
  const style = TIER_STYLE[tier];
  return (
    <span
      className={`num inline-flex shrink-0 items-center gap-1 rounded-md border font-semibold tracking-wider ${
        size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-px text-[9.5px]"
      }`}
      style={{ color: style.color, borderColor: `${style.color}55`, background: `${style.color}14` }}
    >
      {(tier === "prod" || tier === "preprod") && <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.color }} />}
      {style.label}
    </span>
  );
}
