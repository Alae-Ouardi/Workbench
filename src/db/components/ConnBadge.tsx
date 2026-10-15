import { EnvBadge } from "../../shared/EnvBadge";
import { envTier } from "../../shared/envKind";
import { isLocal } from "../logic/connections";
import type { Connection } from "../types";

/** The environment chip, or LOCAL for a database reached directly. */
export function ConnBadge({ connection: c, size = "sm" }: { connection: Connection; size?: "sm" | "md" }) {
  if (!isLocal(c)) return <EnvBadge tier={envTier(c.env)} size={size} />;
  return (
    <span
      className={`num inline-flex shrink-0 items-center rounded-md border border-teal-400/35 bg-teal-400/10 font-semibold tracking-wider text-teal-300 ${
        size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-px text-[9.5px]"
      }`}
    >
      LOCAL
    </span>
  );
}
