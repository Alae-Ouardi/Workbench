import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listProjects, listTasks, onBoardChanged, tpListQueue } from "../api";
import type { ProjectSummary, Status, SyncQueueItem, Task } from "../types";
import { TpChip } from "./tp/TpChip";
import { TrayFooter } from "./tray/TrayFooter";
import { TrayProjectMenu } from "./tray/TrayProjectMenu";
import { TrayQuickAdd } from "./tray/TrayQuickAdd";
import { TrayTaskRow } from "./tray/TrayTaskRow";
import { FILTER_ORDER, STATUS_CONFIG, STATUS_ORDER } from "./tray/trayConfig";

/** Only one of the header's sub-panels is open at a time. */
type Sheet = "none" | "add" | "project";

export function TrayPopover() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const refresh = useCallback(async () => {
    const [ps, ts, q] = await Promise.all([
      listProjects(),
      listTasks(selectedProjectId),
      // The queue drives the footer indicator; a failure here must not stop the
      // board from rendering.
      tpListQueue().catch(() => [] as SyncQueueItem[]),
    ]);
    setProjects(ps);
    setTasks(ts);
    setQueue(q);
    if (selectedProjectId === null && ps.length > 0) {
      setSelectedProjectId(ps[0].id);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onBoardChanged(() => refresh()).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  const projectTasks =
    selectedProjectId !== null ? tasks.filter((t) => t.project_id === selectedProjectId) : tasks;

  const sorted = [...projectTasks].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
  const byStatus =
    statusFilter === "all" ? sorted : sorted.filter((t) => t.status === statusFilter);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? byStatus.filter((t) => t.title.toLowerCase().includes(needle))
    : byStatus;

  // Only count what concerns the selected project, so the footer matches the list.
  const relevantQueue =
    selectedProjectId !== null
      ? queue.filter((q) => q.project_id === selectedProjectId)
      : queue;
  const failedCount = relevantQueue.filter((q) => q.exhausted).length;
  const pendingCount = relevantQueue.length - failedCount;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--panel)] text-slate-300">
      {/* --- header --- */}
      <div className="shrink-0 border-b border-white/[0.06] bg-gradient-to-b from-[var(--panel-2)] to-[var(--panel)] px-4 pb-3 pt-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-[13px] font-semibold tracking-tight text-slate-100">
              TaskBoard
            </span>
            {selectedProject?.tp_user_story_id != null && (
              <TpChip
                entityId={selectedProject.tp_user_story_id}
                label="US"
                title={`Open user story #${selectedProject.tp_user_story_id}${
                  selectedProject.tp_user_story_name
                    ? ` — ${selectedProject.tp_user_story_name}`
                    : ""
                } in TargetProcess`}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              active={sheet === "add"}
              onClick={() => {
                setSheet((s) => (s === "add" ? "none" : "add"));
                setExpandedId(null);
              }}
              title="Quick-add task"
            >
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </IconButton>
            <IconButton
              active={sheet === "project"}
              disabled={!selectedProject}
              onClick={() => {
                setSheet((s) => (s === "project" ? "none" : "project"));
                setExpandedId(null);
              }}
              title="Project settings — TargetProcess link, delete project"
            >
              <path
                d="M8 4.5v.01M8 8v.01M8 11.5v.01"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </IconButton>
            <button
              onClick={() => invoke("show_main_window")}
              className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-300"
              title="Open full board"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 3h7v7M13 3L3 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Board
            </button>
          </div>
        </div>
        <select
          value={selectedProjectId ?? ""}
          onChange={(e) => {
            setSelectedProjectId(e.target.value ? Number(e.target.value) : null);
            setSheet("none");
          }}
          className="w-full appearance-none rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 pr-7 text-[12px] text-slate-200 outline-none transition-colors focus:border-sky-500/40 focus:bg-white/[0.05]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 10px center",
          }}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.tp_user_story_id != null ? `${p.name} · TP` : p.name}
            </option>
          ))}
        </select>
      </div>

      {sheet === "add" && (
        <TrayQuickAdd
          project={selectedProject}
          onCreated={() => {
            setSheet("none");
            refresh();
          }}
          onCancel={() => setSheet("none")}
        />
      )}

      {sheet === "project" && selectedProject && (
        <TrayProjectMenu
          project={selectedProject}
          onClose={() => setSheet("none")}
          onChanged={refresh}
          onDeleted={() => {
            setSheet("none");
            setSelectedProjectId(null);
            refresh();
          }}
        />
      )}

      {/* --- search + status tabs --- */}
      <div className="shrink-0 border-b border-white/[0.06] px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks…"
          className="mb-2 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-300 outline-none placeholder:text-slate-700 focus:border-sky-500/40"
        />
        <div className="flex gap-1 overflow-x-auto">
          {(["all", ...FILTER_ORDER] as const).map((s) => {
            const active = statusFilter === s;
            const cfg =
              s === "all"
                ? { label: "All", dot: "bg-slate-500", bg: "bg-slate-500/15 text-slate-300" }
                : STATUS_CONFIG[s];
            const count = s === "all" ? sorted.length : sorted.filter((t) => t.status === s).length;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                  active ? cfg.bg : "text-slate-600 hover:bg-white/[0.04] hover:text-slate-400"
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
                {count > 0 && <span className="opacity-60">{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* --- list --- */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03]">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-slate-600">
                <path d="M4 8h8M8 4v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
                <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <p className="text-[12px] text-slate-600">
              {needle || statusFilter !== "all" ? "Nothing matches" : "No tasks yet"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-700">
              {needle || statusFilter !== "all" ? "Try another filter" : "Click + to create one"}
            </p>
          </div>
        ) : (
          <div className="p-2">
            {visible.map((task) => (
              <TrayTaskRow
                key={task.id}
                task={task}
                expanded={expandedId === task.id}
                onToggle={() => setExpandedId((id) => (id === task.id ? null : task.id))}
                onSaved={refresh}
              />
            ))}
          </div>
        )}
      </div>

      <TrayFooter
        visible={visible}
        all={projectTasks}
        pendingCount={pendingCount}
        failedCount={failedCount}
        onSynced={refresh}
      />
    </div>
  );
}

interface IconButtonProps {
  active: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function IconButton({ active, disabled, title, onClick, children }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all disabled:opacity-30 ${
        active
          ? "bg-sky-500/15 text-sky-400"
          : "text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        {children}
      </svg>
    </button>
  );
}
