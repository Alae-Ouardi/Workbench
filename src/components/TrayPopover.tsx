import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import packageJson from "../../package.json";
import {
  createTask,
  deleteTask,
  listProjects,
  listTasks,
  onBoardChanged,
  setStatus,
  updateTask,
} from "../api";
import type { Kind, Priority, ProjectSummary, Status, Task } from "../types";

const STATUS_CONFIG: Record<Status, { dot: string; label: string; bg: string }> = {
  open: { dot: "bg-slate-400", label: "Open", bg: "bg-slate-400/10 text-slate-400" },
  waiting: { dot: "bg-yellow-500", label: "Waiting", bg: "bg-yellow-500/10 text-yellow-500" },
  in_progress: { dot: "bg-violet-500", label: "In Progress", bg: "bg-violet-500/10 text-violet-400" },
  review: { dot: "bg-sky-400", label: "Review", bg: "bg-sky-400/10 text-sky-400" },
  done: { dot: "bg-emerald-500", label: "Done", bg: "bg-emerald-500/10 text-emerald-400" },
};

const PRIORITY_CONFIG: Record<Priority, { color: string; label: string }> = {
  low: { color: "text-slate-500", label: "Low" },
  normal: { color: "text-sky-400", label: "Normal" },
  high: { color: "text-amber-400", label: "High" },
  urgent: { color: "text-red-400", label: "Urgent" },
};

const STATUSES: Status[] = ["open", "waiting", "in_progress", "review", "done"];
const PRIORITIES: Priority[] = ["low", "normal", "high", "urgent"];

export function TrayPopover() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  const refresh = useCallback(async () => {
    const [ps, ts] = await Promise.all([
      listProjects(),
      listTasks(selectedProjectId),
    ]);
    setProjects(ps);
    setTasks(ts.filter((t) => t.status !== "done"));
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
      unlistenRef.current = fn;
    });
    return () => { unlisten?.(); };
  }, [refresh]);

  const activeTasks = selectedProjectId !== null
    ? tasks.filter((t) => t.project_id === selectedProjectId)
    : tasks;

  return (
    <div className="flex h-screen flex-col bg-[#0d1018] text-slate-300">
      <div className="shrink-0 border-b border-white/[0.06] bg-gradient-to-b from-[#13171f] to-[#0d1018] px-4 pb-3 pt-3.5">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-500/10">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-sky-400">
                <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
              </svg>
            </div>
            <span className="text-[13px] font-semibold tracking-tight text-slate-100">TaskBoard</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setShowAdd((s) => !s); setExpandedId(null); }}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-all ${
                showAdd
                  ? "bg-sky-500/15 text-sky-400"
                  : "text-slate-500 hover:bg-white/[0.06] hover:text-slate-300"
              }`}
              title="Quick-add task"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => invoke("show_main_window")}
              className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-300"
              title="Open full board"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M6 3h7v7M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Board
            </button>
          </div>
        </div>
        <select
          value={selectedProjectId ?? ""}
          onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
          className="w-full appearance-none rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 pr-7 text-[12px] text-slate-200 outline-none transition-colors focus:border-sky-500/40 focus:bg-white/[0.05]"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {showAdd && (
        <QuickAdd
          project={selectedProject}
          onCreated={() => { setShowAdd(false); refresh(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {activeTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-16">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.03]">
              <svg width="20" height="20" viewBox="0 0 16 16" fill="none" className="text-slate-600">
                <path d="M4 8h8M8 4v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
                <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <p className="text-[12px] text-slate-600">No active tasks</p>
            <p className="mt-0.5 text-[11px] text-slate-700">Click + to create one</p>
          </div>
        ) : (
          <div className="p-2">
            {activeTasks.map((task) => (
              <TaskRow
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

      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.04] px-4 py-1.5">
        <span className="text-[10px] text-slate-700">v{packageJson.version}</span>
        <span className="text-[10px] text-slate-700">
          {activeTasks.length} active {activeTasks.length === 1 ? "task" : "tasks"}
        </span>
      </div>
    </div>
  );
}

function QuickAdd({ project, onCreated, onCancel }: {
  project: ProjectSummary | null;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Kind>("task");
  const [priority, setPriority] = useState<Priority>("normal");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !project) return;
    setSaving(true);
    try {
      await createTask({
        projectPath: project.path,
        title: title.trim(),
        description: description.trim(),
        kind,
        priority,
        assignee: "me",
      });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="shrink-0 border-b border-white/[0.06] bg-[#0a0d13] px-3 py-3">
      {!project && (
        <p className="mb-2 rounded-md bg-yellow-500/10 px-2.5 py-1.5 text-[11px] text-yellow-500">
          Select a project first.
        </p>
      )}
      <div className="mb-2.5 flex items-center gap-1.5">
        {(["task", "bug"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all ${
              kind === k
                ? k === "bug"
                  ? "bg-red-500/15 text-red-400"
                  : "bg-sky-500/15 text-sky-400"
                : "text-slate-600 hover:text-slate-400"
            }`}
          >
            {k === "bug" ? "Bug" : "Task"}
          </button>
        ))}
        <div className="ml-auto">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className={`rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[11px] outline-none ${PRIORITY_CONFIG[priority].color}`}
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>)}
          </select>
        </div>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs to be done?"
        className="mb-2 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[12px] text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-sky-500/30 focus:bg-white/[0.05]"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        className="mb-2.5 w-full resize-none rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400 outline-none transition-colors placeholder:text-slate-700 focus:border-sky-500/30 focus:bg-white/[0.05]"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving || !project}
          className="flex-1 rounded-lg bg-sky-600 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-30"
        >
          {saving ? "Adding..." : "Add Task"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function TaskRow({ task, expanded, onToggle, onSaved }: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [description, setDescription] = useState(task.description);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setPriority(task.priority);
    setDescription(task.description);
  }, [task]);

  async function handleStatusChange(newStatus: Status) {
    await setStatus(task.id, newStatus);
    onSaved();
  }

  async function save() {
    setSaving(true);
    try {
      await updateTask(task.id, { title, priority, description });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await deleteTask(task.id);
    onSaved();
  }

  const statusCfg = STATUS_CONFIG[task.status];
  const priorityCfg = PRIORITY_CONFIG[task.priority];

  return (
    <div className={`mb-1 rounded-lg border transition-colors ${
      expanded
        ? "border-white/[0.08] bg-white/[0.03]"
        : "border-transparent hover:border-white/[0.04] hover:bg-white/[0.02]"
    }`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${statusCfg.dot}`} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-snug text-slate-200">{task.title}</span>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[10px] text-slate-600">#{task.id}</span>
            {task.kind === "bug" && (
              <span className="rounded bg-red-500/10 px-1 py-px text-[9px] font-medium uppercase text-red-400">bug</span>
            )}
            <span className={`text-[10px] ${priorityCfg.color}`}>{priorityCfg.label}</span>
          </div>
        </div>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusCfg.bg}`}>
          {statusCfg.label}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 16 16" fill="none"
          className={`shrink-0 text-slate-600 transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-white/[0.06] px-3 pb-3 pt-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-2.5 w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[12px] text-slate-200 outline-none transition-colors focus:border-sky-500/30"
          />
          <div className="mb-2.5 grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Status</label>
              <select
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value as Status)}
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-slate-300 outline-none transition-colors focus:border-sky-500/30"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-slate-300 outline-none transition-colors focus:border-sky-500/30"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_CONFIG[p].label}</option>)}
              </select>
            </div>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Description"
            className="mb-2.5 w-full resize-none rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-400 outline-none transition-colors placeholder:text-slate-700 focus:border-sky-500/30"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 rounded-lg bg-sky-600 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-30"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {confirmDelete ? (
              <div className="flex gap-1.5">
                <button
                  onClick={handleDelete}
                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-red-500"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] text-slate-500 transition-colors hover:text-slate-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                title="Delete task"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M2 4h12M6 7v5M10 7v5M3 4l1 9a2 2 0 002 2h4a2 2 0 002-2l1-9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
