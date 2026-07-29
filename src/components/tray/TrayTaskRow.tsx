import { useEffect, useState } from "react";
import { deleteTask, setStatus, updateTask } from "../../api";
import type { Priority, Status, Task } from "../../types";
import { EstimateBadge, EstimateInput } from "../tp/EstimateInput";
import { SyncBadge } from "../tp/SyncBadge";
import { TpChip } from "../tp/TpChip";
import { PRIORITIES, PRIORITY_CONFIG, STATUS_CONFIG, STATUSES } from "./trayConfig";

interface TrayTaskRowProps {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}

/**
 * Two lines per task: the title, then a meta strip carrying everything you'd
 * otherwise have to open the board for — the TargetProcess link, the estimate,
 * priority and assignee. Expanding switches the row into an editor.
 */
export function TrayTaskRow({ task, expanded, onToggle, onSaved }: TrayTaskRowProps) {
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [description, setDescription] = useState(task.description);
  const [estimate, setEstimate] = useState(task.estimate_points);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(task.title);
    setPriority(task.priority);
    setDescription(task.description);
    setEstimate(task.estimate_points);
  }, [task]);

  async function handleStatusChange(newStatus: Status) {
    await setStatus(task.id, newStatus);
    onSaved();
  }

  async function save() {
    setSaving(true);
    try {
      await updateTask(task.id, {
        title,
        priority,
        description,
        estimatePoints: estimate,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const statusCfg = STATUS_CONFIG[task.status];
  const priorityCfg = PRIORITY_CONFIG[task.priority];

  return (
    <div
      className={`mb-1 rounded-lg border transition-colors ${
        expanded
          ? "border-white/[0.08] bg-white/[0.03]"
          : "border-transparent hover:border-white/[0.04] hover:bg-white/[0.02]"
      }`}
    >
      <button onClick={onToggle} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${statusCfg.dot}`} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[12px] leading-snug text-slate-200">
            {task.title}
          </span>
          {/* meta strip */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] text-slate-600">#{task.id}</span>
            {task.kind === "bug" && (
              <span className="rounded bg-red-500/10 px-1 py-px text-[9px] font-medium uppercase text-red-400">
                bug
              </span>
            )}
            <span className={`text-[10px] ${priorityCfg.color}`}>{priorityCfg.label}</span>
            <EstimateBadge points={task.estimate_points} logged={task.tp_time_logged} />
            {task.tp_entity_id !== null && (
              <TpChip entityId={task.tp_entity_id} label={task.tp_entity_type} />
            )}
            {task.assignee && (
              <span className="truncate text-[10px] text-slate-600">{task.assignee}</span>
            )}
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <SyncBadge state={task.tp_sync_state} error={task.tp_sync_error} />
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusCfg.bg}`}>
            {statusCfg.label}
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            className={`text-slate-600 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
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
                className={selectClass}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_CONFIG[s].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={selectClass}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_CONFIG[p].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-2.5 flex items-center gap-2">
            <label className="text-[10px] font-medium text-slate-600">Estimate</label>
            <EstimateInput value={estimate} onChange={setEstimate} compact />
            {task.tp_time_logged > 0 && (
              <span className="text-[10px] text-emerald-500">logged</span>
            )}
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Description"
            className="mb-2.5 w-full resize-none rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-400 outline-none transition-colors placeholder:text-slate-700 focus:border-sky-500/30"
          />

          {task.tp_sync_error && (
            <p className="mb-2.5 break-words rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-red-400">
              {task.tp_sync_error}
            </p>
          )}

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
                  onClick={async () => {
                    await deleteTask(task.id);
                    onSaved();
                  }}
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
                  <path
                    d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M2 4h12M6 7v5M10 7v5M3 4l1 9a2 2 0 002 2h4a2 2 0 002-2l1-9"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const selectClass =
  "w-full rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px] text-slate-300 outline-none transition-colors focus:border-sky-500/30";
