import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOverlay } from "../../shared/overlay";
import { openInTp } from "../api";
import { useTpwQuery } from "../hooks/useTpwQuery";
import { matchesText } from "../logic/work";
import { useWorkspace } from "../WorkspaceContext";
import type { TpWorkItem } from "../types";
import { IconExternal, IconSearch } from "./icons";
import { TypeBadge, TpId } from "./ui";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: () => void;
}

type Row =
  | { kind: "command"; command: PaletteCommand }
  | { kind: "item"; item: TpWorkItem };

const MAX_ITEMS = 40;

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  useOverlay();
  const { sprint, myWork, setOpenItem } = useWorkspace();
  const sprintQ = useTpwQuery<TpWorkItem[]>(sprint ? { kind: "sprint_items", sprint_id: sprint.id } : null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const cmds = commands
      .filter((c) => !q || c.label.toLowerCase().includes(q))
      .map((command) => ({ kind: "command" as const, command }));
    if (!q) return cmds;
    const seen = new Set<number>();
    const items = [...myWork, ...(sprintQ.data ?? [])]
      .filter((i) => !seen.has(i.id) && seen.add(i.id) && matchesText(i, q))
      .slice(0, MAX_ITEMS)
      .map((item) => ({ kind: "item" as const, item }));
    return [...items, ...cmds];
  }, [query, commands, myWork, sprintQ.data]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function activate(row: Row | undefined, external = false) {
    if (!row) return;
    if (row.kind === "command") row.command.run();
    else if (external) void openInTp(row.item.id);
    else setOpenItem(row.item);
    onClose();
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
      activate(rows[cursor], e.metaKey);
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
            placeholder="Search work items by name or #id, or jump to a view…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="chip num">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {rows.length === 0 && <p className="px-3 py-8 text-center text-xs text-slate-500">Nothing matches “{query}”.</p>}
          {rows.map((row, i) => (
            <button
              key={row.kind === "command" ? row.command.id : `item-${row.item.id}`}
              data-row={i}
              onMouseEnter={() => setCursor(i)}
              onClick={() => activate(row)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                i === cursor ? "bg-[var(--line)] text-slate-50" : "text-slate-300"
              }`}
            >
              {row.kind === "command" ? (
                <>
                  <span className="text-slate-500">{row.command.icon}</span>
                  <span className="flex-1">{row.command.label}</span>
                  {row.command.hint && <kbd className="chip num">{row.command.hint}</kbd>}
                </>
              ) : (
                <>
                  <TypeBadge type={row.item.entity_type} />
                  <TpId id={row.item.id} className="text-xs text-slate-500" />
                  <span className="flex-1 truncate">{row.item.name}</span>
                  <span className="truncate text-[11px] text-slate-500">{row.item.state.name}</span>
                  {i === cursor && <IconExternal size={12} className="text-slate-500" />}
                </>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-4 border-t border-[var(--line)] px-4 py-2 text-[11px] text-slate-500">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌘↵ open in TargetProcess</span>
        </div>
      </div>
    </div>
  );
}
