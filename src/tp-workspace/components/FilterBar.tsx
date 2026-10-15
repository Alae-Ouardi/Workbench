import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../WorkspaceContext";
import { IconSearch } from "./icons";

export function FilterBar({ showSprint = true }: { showSprint?: boolean }) {
  const { filters, setFilters, me, sprints, sprint, setSprintId } = useWorkspace();

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="relative min-w-40 max-w-72 flex-1">
        <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          className="input pl-8"
          placeholder="Filter by name, #id, tag, person…"
          value={filters.text}
          onChange={(e) => setFilters({ ...filters, text: e.target.value })}
        />
      </div>
      <ProjectPicker />
      {showSprint && sprints.length > 0 && (
        <select
          className="input w-auto max-w-56"
          value={sprint?.id ?? ""}
          onChange={(e) => setSprintId(Number(e.target.value))}
          title="Sprint"
        >
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.team_name ? ` · ${s.team_name}` : ""}
            </option>
          ))}
        </select>
      )}
      <div className="flex rounded-lg border border-[var(--line)] p-0.5">
        {[
          { label: "Everyone", value: null },
          { label: "Mine", value: me?.id ?? -1 },
        ].map((opt) => (
          <button
            key={opt.label}
            disabled={opt.value === -1}
            onClick={() => setFilters({ ...filters, assigneeId: opt.value })}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
              filters.assigneeId === opt.value ? "bg-[var(--line)] text-slate-100" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProjectPicker() {
  const { projects, filters, setFilters, projectColor } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const selected = projects.filter((p) => filters.projectIds.includes(p.id));
  const visible = projects.filter((p) =>
    `${p.name} ${p.abbreviation}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function toggle(id: number) {
    const ids = filters.projectIds.includes(id)
      ? filters.projectIds.filter((x) => x !== id)
      : [...filters.projectIds, id];
    setFilters({ ...filters, projectIds: ids });
  }

  return (
    <div ref={ref} className="relative">
      <button className="btn" onClick={() => setOpen(!open)}>
        {selected.length === 0 ? (
          "All projects"
        ) : (
          <span className="flex items-center gap-1.5">
            {selected.slice(0, 3).map((p) => (
              <span key={p.id} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: projectColor(p.id) }} />
                {p.abbreviation || p.name}
              </span>
            ))}
            {selected.length > 3 && <span className="text-slate-500">+{selected.length - 3}</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="glass-strong animate-rise absolute left-0 top-full z-30 mt-1 w-72 rounded-xl p-2 shadow-2xl">
          <input
            autoFocus
            className="input mb-2"
            placeholder="Search projects (ILS, Evo…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="max-h-72 overflow-y-auto">
            {visible.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:bg-[var(--line-soft)]"
              >
                <input type="checkbox" checked={filters.projectIds.includes(p.id)} onChange={() => toggle(p.id)} />
                <span className="h-2 w-2 rounded-full" style={{ background: projectColor(p.id) }} />
                <span className="truncate">{p.name}</span>
                {p.abbreviation && <span className="ml-auto text-slate-600">{p.abbreviation}</span>}
              </label>
            ))}
            {visible.length === 0 && <p className="px-2 py-3 text-xs text-slate-500">No project matches.</p>}
          </div>
          {filters.projectIds.length > 0 && (
            <button className="btn mt-2 w-full justify-center" onClick={() => setFilters({ ...filters, projectIds: [] })}>
              Clear selection
            </button>
          )}
        </div>
      )}
    </div>
  );
}
