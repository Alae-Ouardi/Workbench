import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

const STATUS_DOT: Record<Status, string> = {
  open: "bg-slate-500",
  waiting: "bg-yellow-600",
  in_progress: "bg-violet-500",
  review: "bg-sky-500",
  done: "bg-emerald-600",
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
    <div className="flex h-screen flex-col bg-[#0d1018] text-xs text-slate-300">
      {/* header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1c2230] px-3 py-2.5">
        <select
          value={selectedProjectId ?? ""}
          onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
          className="flex-1 rounded border border-[#2a3040] bg-[#11151f] px-2 py-1 text-xs text-slate-200 outline-none"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          onClick={() => { setShowAdd((s) => !s); setExpandedId(null); }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[#2a3040] text-slate-400 hover:text-sky-300"
          title="Quick-add task"
        >
          +
        </button>
        <button
          onClick={() => invoke("show_main_window")}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-slate-600 hover:text-slate-300"
          title="Open full board"
        >
          ⬡ Board
        </button>
      </div>

      {/* quick-add form */}
      {showAdd && (
        <QuickAdd
          project={selectedProject}
          onCreated={() => { setShowAdd(false); refresh(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* task list */}
      <div className="flex-1 overflow-y-auto">
        {activeTasks.length === 0 ? (
          <div className="px-4 py-6 text-center text-slate-700 italic">No active tasks</div>
        ) : (
          activeTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              onToggle={() => setExpandedId((id) => (id === task.id ? null : task.id))}
              onSaved={refresh}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ---- QuickAdd ----

interface QuickAddProps {
  project: ProjectSummary | null;
  onCreated: () => void;
  onCancel: () => void;
}

function QuickAdd({ project, onCreated, onCancel }: QuickAddProps) {
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
    <form onSubmit={submit} className="border-b border-[#1c2230] bg-[#0b0e14] px-3 py-2.5">
      {!project && (
        <p className="mb-2 text-[10px] text-yellow-600">Select a project first.</p>
      )}
      <div className="mb-2 flex gap-1.5">
        {(["task", "bug"] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
              kind === k
                ? k === "bug" ? "bg-red-900/70 text-red-200" : "bg-sky-900/70 text-sky-200"
                : "bg-[#1c2230] text-slate-500"
            }`}
          >
            {k}
          </button>
        ))}
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="ml-auto rounded border border-[#2a3040] bg-[#11151f] px-1 py-0.5 text-[10px] text-slate-300 outline-none"
        >
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title…"
        className="mb-2 w-full rounded border border-[#2a3040] bg-[#11151f] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="Description (optional)…"
        className="mb-2 w-full resize-none rounded border border-[#2a3040] bg-[#11151f] px-2 py-1 text-[10px] text-slate-400 outline-none focus:border-sky-600"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={saving || !project}
          className="flex-1 rounded bg-sky-700 py-1 text-[10px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {saving ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---- TaskRow (collapsed + inline editor) ----

interface TaskRowProps {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}

function TaskRow({ task, expanded, onToggle, onSaved }: TaskRowProps) {
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

  return (
    <div className="border-b border-[#1c2230]">
      {/* collapsed row */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#141927]"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[task.status]}`} />
        <span className="flex-1 truncate text-slate-300">{task.title}</span>
        <span className="shrink-0 text-[9px] text-slate-500">{task.status.replace("_", " ")}</span>
        <span className={`shrink-0 text-[9px] uppercase font-semibold ${
          task.kind === "bug" ? "text-red-400" : "text-slate-600"
        }`}>{task.kind}</span>
        <span className="shrink-0 text-slate-700">{expanded ? "▴" : "▾"}</span>
      </button>

      {/* inline editor */}
      {expanded && (
        <div className="border-t border-[#1c2230] bg-[#0b0e14] px-3 py-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mb-2 w-full rounded border border-[#2a3040] bg-[#11151f] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
          />
          {/* Status auto-saves immediately on change */}
          <div className="mb-2 flex gap-2">
            <select
              value={task.status}
              onChange={(e) => handleStatusChange(e.target.value as Status)}
              className="flex-1 rounded border border-[#2a3040] bg-[#11151f] px-1 py-1 text-[10px] text-slate-300 outline-none"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace("_", " ")}</option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="flex-1 rounded border border-[#2a3040] bg-[#11151f] px-1 py-1 text-[10px] text-slate-300 outline-none"
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Description…"
            className="mb-2 w-full resize-none rounded border border-[#2a3040] bg-[#11151f] px-2 py-1 text-[10px] text-slate-400 outline-none focus:border-sky-600"
          />
          <div className="flex gap-1.5">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 rounded bg-sky-700 py-1 text-[10px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {confirmDelete ? (
              <>
                <button
                  onClick={handleDelete}
                  className="rounded bg-red-700 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-600"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded px-2 py-1 text-[10px] text-slate-600 hover:text-red-400"
                title="Delete task"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
