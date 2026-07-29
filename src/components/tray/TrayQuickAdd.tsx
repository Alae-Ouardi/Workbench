import { useState } from "react";
import { createTask } from "../../api";
import type { Kind, Priority, ProjectSummary } from "../../types";
import { EstimateInput } from "../tp/EstimateInput";
import { PRIORITIES, PRIORITY_CONFIG } from "./trayConfig";

interface TrayQuickAddProps {
  project: ProjectSummary | null;
  onCreated: () => void;
  onCancel: () => void;
}

export function TrayQuickAdd({ project, onCreated, onCancel }: TrayQuickAddProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Kind>("task");
  const [priority, setPriority] = useState<Priority>("normal");
  const [estimate, setEstimate] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !project) return;
    setSaving(true);
    setError(null);
    try {
      await createTask({
        projectId: project.id,
        title: title.trim(),
        description: description.trim(),
        kind,
        priority,
        assignee: "me",
        estimatePoints: estimate,
      });
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="shrink-0 border-b border-white/[0.06] bg-[#0a0d13] px-3 py-3"
    >
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
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_CONFIG[p].label}
              </option>
            ))}
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
        className="mb-2 w-full resize-none rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-slate-400 outline-none transition-colors placeholder:text-slate-700 focus:border-sky-500/30 focus:bg-white/[0.05]"
      />
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[10px] font-medium text-slate-600">Estimate</span>
        <EstimateInput value={estimate} onChange={setEstimate} compact />
      </div>
      {error && <p className="mb-2 text-[10px] text-red-400">{error}</p>}
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
