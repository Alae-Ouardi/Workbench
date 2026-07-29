import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { tpGetSettings } from "../../api";

/**
 * The TargetProcess base URL, fetched once and shared by every chip.
 *
 * Chips render inside task cards and tray rows, so each one asking the backend
 * for settings would mean dozens of identical calls per render pass.
 */
let baseUrlPromise: Promise<string> | null = null;

function tpBaseUrl(): Promise<string> {
  baseUrlPromise ??= tpGetSettings()
    .then((s) => s.base_url_normalized)
    .catch(() => "");
  return baseUrlPromise;
}

/** Call after the URL changes in Settings, so chips pick the new one up. */
export function resetTpBaseUrl() {
  baseUrlPromise = null;
}

export function useTpBaseUrl(): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    tpBaseUrl().then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, []);
  return url;
}

interface TpChipProps {
  entityId: number;
  /** "Task" | "Bug" | "US" — shown before the id. */
  label?: string;
  /** `sm` for dense rows and cards, `md` for the drawer and banners. */
  size?: "sm" | "md";
  title?: string;
}

/**
 * A clickable TargetProcess entity id. Opens `<base>/entity/<id>` in the
 * browser — TargetProcess resolves the entity type from the id itself.
 */
export function TpChip({ entityId, label = "TP", size = "sm", title }: TpChipProps) {
  const baseUrl = useTpBaseUrl();
  const disabled = !baseUrl;

  return (
    <button
      type="button"
      disabled={disabled}
      title={
        title ??
        (disabled
          ? "Set the TargetProcess URL in Settings to open this"
          : `Open ${label} #${entityId} in TargetProcess`)
      }
      onClick={(e) => {
        e.stopPropagation();
        if (baseUrl) void openUrl(`${baseUrl}/entity/${entityId}`);
      }}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded border border-sky-900/60 bg-sky-950/40 font-mono text-sky-400 transition-colors hover:border-sky-700 hover:bg-sky-900/40 hover:text-sky-300 disabled:cursor-default disabled:opacity-50 disabled:hover:border-sky-900/60 ${
        size === "sm" ? "px-1 py-px text-[10px]" : "px-1.5 py-0.5 text-xs"
      }`}
    >
      {label} #{entityId}
      <span aria-hidden className="opacity-70">
        ↗
      </span>
    </button>
  );
}
