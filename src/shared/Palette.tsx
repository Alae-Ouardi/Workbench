// Generic ⌘K palette: a filterable list of entries run with Enter. Workspaces
// build the entries (commands, resources, connections…) and pass them in.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOverlay } from "./overlay";
import { IconSearch } from "./icons";
import { rankEntries } from "./paletteSearch";

export interface PaletteEntry {
  id: string;
  label: string;
  /** Shown dimmed on the right (namespace, type…). */
  detail?: string;
  /** Group heading, e.g. "Pods" or "Commands". */
  group?: string;
  icon?: ReactNode;
  hint?: string;
  /** Extra words that should match (aliases, ids). */
  keywords?: string;
  run: () => void;
}

const MAX_ROWS = 60;

export function Palette({
  entries,
  placeholder,
  onClose,
}: {
  entries: PaletteEntry[];
  placeholder: string;
  onClose: () => void;
}) {
  useOverlay();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => rankEntries(entries, query).slice(0, MAX_ROWS), [entries, query]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function activate(entry: PaletteEntry | undefined) {
    if (!entry) return;
    onClose();
    entry.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(rows[cursor]);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-strong neon-ring animate-rise w-[640px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
          <IconSearch className="text-sky-400" />
          <input
            autoFocus
            className="bare-input flex-1 bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="chip num">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {rows.length === 0 && <p className="px-3 py-8 text-center text-xs text-slate-500">Nothing matches “{query}”.</p>}
          {rows.map((entry, i) => (
            <div key={entry.id}>
              {entry.group && entry.group !== rows[i - 1]?.group && (
                <div className="label px-3 pt-2 pb-1">{entry.group}</div>
              )}
              <button
                data-row={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => activate(entry)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                  i === cursor ? "bg-[var(--line)] text-slate-50" : "text-slate-300"
                }`}
              >
                {entry.icon && <span className="text-slate-500">{entry.icon}</span>}
                <span className="flex-1 truncate">{entry.label}</span>
                {entry.detail && <span className="truncate text-[11px] text-slate-500">{entry.detail}</span>}
                {entry.hint && <kbd className="chip num">{entry.hint}</kbd>}
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-4 border-t border-[var(--line)] px-4 py-2 text-[11px] text-slate-500">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
        </div>
      </div>
    </div>
  );
}
