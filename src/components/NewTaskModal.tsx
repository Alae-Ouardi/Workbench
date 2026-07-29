import { useState } from "react";
import type { Kind, NewTaskInput, Priority, ProjectSummary } from "../types";
import { EstimateInput } from "./tp/EstimateInput";

interface NewTaskModalProps {
  projects: ProjectSummary[];
  defaultProjectId: number | null;
  onSubmit: (input: NewTaskInput) => Promise<void>;
  onClose: () => void;
}

export function NewTaskModal({ projects, defaultProjectId, onSubmit, onClose }: NewTaskModalProps) {
  const defaultProject =
    projects.find((p) => p.id === defaultProjectId) ?? projects[0] ?? null;
  const [projectId, setProjectId] = useState<number | null>(
    defaultProject?.id ?? null,
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Kind>("task");
  const [priority, setPriority] = useState<Priority>("normal");
  const [assignee, setAssignee] = useState("me");
  const [estimate, setEstimate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (projectId === null) {
      setError("Choose a project.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        projectId,
        title: title.trim(),
        description: description.trim(),
        kind,
        priority,
        assignee: assignee.trim(),
        estimatePoints: estimate,
      });
      onClose();
    } catch (err: unknown) {
      setError(String(err));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="w-[480px] rounded-xl border border-[#2a3040] bg-[#11151f] p-5 shadow-2xl"
      >
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">
          New {kind}
        </h2>

        <div className="mb-3 flex gap-2">
          {(["task", "bug"] as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1 text-xs font-semibold uppercase ${
                kind === k
                  ? k === "bug"
                    ? "bg-red-900/70 text-red-200"
                    : "bg-sky-900/70 text-sky-200"
                  : "bg-[#1c2230] text-slate-500 hover:text-slate-300"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs text-slate-500">Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-3 w-full rounded-md border border-[#2a3040] bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-sky-600"
          placeholder={kind === "bug" ? "What is broken?" : "What needs to be done?"}
        />

        <label className="mb-1 block text-xs text-slate-500">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mb-3 w-full resize-none rounded-md border border-[#2a3040] bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-sky-600"
          placeholder="Context, acceptance criteria, repro steps…"
        />

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">Project</label>
            <select
              value={projectId ?? ""}
              onChange={(e) => setProjectId(Number(e.target.value))}
              className="w-full rounded-md border border-[#2a3040] bg-[#0b0e14] px-2 py-2 text-sm outline-none focus:border-sky-600"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
              className="w-full rounded-md border border-[#2a3040] bg-[#0b0e14] px-2 py-2 text-sm outline-none focus:border-sky-600"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        <label className="mb-1 block text-xs text-slate-500">Assignee</label>
        <input
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="mb-4 w-full rounded-md border border-[#2a3040] bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-sky-600"
          placeholder="me, claude-code, codex, opencode…"
        />

        <label className="mb-1 block text-xs text-slate-500">Estimate</label>
        <div className="mb-1">
          <EstimateInput value={estimate} onChange={setEstimate} />
        </div>
        <p className="mb-4 text-[10px] leading-relaxed text-slate-600">
          Human effort in points: 1 = 1 hour, 0.5 = 30 min. Logged as time spent in
          TargetProcess when the task is completed.
        </p>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-sky-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
