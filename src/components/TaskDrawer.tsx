import { useEffect, useState } from "react";
import { addComment, deleteTask, getTask, setStatus, updateTask } from "../api";
import { formatEstimate, type Priority, type Status, type TaskDetail } from "../types";
import { EstimateInput } from "./tp/EstimateInput";
import { SyncBadge } from "./tp/SyncBadge";
import { TpChip } from "./tp/TpChip";
import { STATUS_LABELS, STATUSES } from "../types";

interface TaskDrawerProps {
  taskId: number;
  onClose: () => void;
  onRefresh: () => void;
}

export function TaskDrawer({ taskId, onClose, onRefresh }: TaskDrawerProps) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [comment, setComment] = useState("");
  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const d = await getTask(taskId);
      setDetail(d);
    } catch {
      onClose();
    }
  }

  useEffect(() => {
    load();
  }, [taskId]);

  async function handleStatusChange(status: Status) {
    if (!detail) return;
    await setStatus(taskId, status);
    onRefresh();
    await load();
  }

  async function handleAddComment() {
    if (!comment.trim()) return;
    setSaving(true);
    try {
      await addComment(taskId, comment.trim());
      setComment("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleTitleSave() {
    if (editTitle === null || !editTitle.trim()) return;
    await updateTask(taskId, { title: editTitle.trim() });
    setEditTitle(null);
    onRefresh();
    await load();
  }

  async function handleDescSave() {
    if (editDescription === null) return;
    await updateTask(taskId, { description: editDescription });
    setEditDescription(null);
    onRefresh();
    await load();
  }

  async function handlePriorityChange(priority: string) {
    await updateTask(taskId, { priority });
    onRefresh();
    await load();
  }

  async function handleEstimateChange(estimatePoints: number) {
    await updateTask(taskId, { estimatePoints });
    onRefresh();
    await load();
  }

  async function handleDelete() {
    if (!confirm(`Delete task #${taskId}?`)) return;
    await deleteTask(taskId);
    onRefresh();
    onClose();
  }

  if (!detail) {
    return (
      <aside className="flex w-96 shrink-0 items-center justify-center border-l border-[var(--line-soft)] bg-[var(--panel)]">
        <span className="text-sm text-slate-600">Loading…</span>
      </aside>
    );
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-[var(--line-soft)] bg-[var(--panel)]">
      {/* header */}
      <div className="flex items-center justify-between border-b border-[var(--line-soft)] px-4 py-3">
        <span className="text-xs text-slate-500">#{detail.id}</span>
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            className="rounded px-2 py-1 text-xs text-slate-600 hover:text-red-400"
          >
            delete
          </button>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* title */}
        <div className="px-4 py-4">
          {editTitle !== null ? (
            <div className="flex flex-col gap-2">
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleTitleSave();
                  if (e.key === "Escape") setEditTitle(null);
                }}
                className="rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-600"
              />
              <div className="flex gap-1">
                <button
                  onClick={handleTitleSave}
                  className="rounded bg-sky-700 px-2 py-0.5 text-xs text-white"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditTitle(null)}
                  className="rounded px-2 py-0.5 text-xs text-slate-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditTitle(detail.title)}
              className="text-left text-sm font-semibold leading-snug text-slate-100 hover:text-sky-300"
            >
              {detail.title}
            </button>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            {detail.kind === "bug" && (
              <span className="rounded bg-red-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-300">
                bug
              </span>
            )}
            <StatusBadge status={detail.status} onChange={handleStatusChange} />
            <PriorityBadge priority={detail.priority} onChange={handlePriorityChange} />
            {detail.assignee && (
              <span className="rounded bg-[var(--line-soft)] px-2 py-0.5 text-[10px] text-slate-400">
                {detail.assignee}
              </span>
            )}
            {detail.tp_entity_id !== null && (
              <TpChip entityId={detail.tp_entity_id} label={detail.tp_entity_type} size="md" />
            )}
            <SyncBadge
              state={detail.tp_sync_state}
              error={detail.tp_sync_error}
              withLabel
            />
          </div>

          {/* estimate */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-slate-600">Estimate</span>
            <EstimateInput value={detail.estimate_points} onChange={handleEstimateChange} />
            {detail.tp_time_logged > 0 && (
              <span className="text-[10px] text-emerald-500">
                {formatEstimate(detail.tp_time_logged)} logged
              </span>
            )}
          </div>
          {detail.tp_sync_error && (
            <p className="mt-2 break-words rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 text-[10px] leading-relaxed text-red-400">
              {detail.tp_sync_error}
            </p>
          )}
        </div>

        {/* description */}
        <div className="px-4 pb-4">
          <div className="mb-1 text-xs text-slate-600">Description</div>
          {editDescription !== null ? (
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
                className="w-full resize-none rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs text-slate-300 outline-none focus:border-sky-600"
              />
              <div className="flex gap-1">
                <button
                  onClick={handleDescSave}
                  className="rounded bg-sky-700 px-2 py-0.5 text-xs text-white"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditDescription(null)}
                  className="rounded px-2 py-0.5 text-xs text-slate-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditDescription(detail.description)}
              className="w-full text-left text-xs leading-relaxed text-slate-400 hover:text-slate-200"
            >
              {detail.description || (
                <span className="text-slate-700 italic">Click to add description…</span>
              )}
            </button>
          )}
        </div>

        {/* dependencies */}
        {(detail.depends_on.length > 0 || detail.blocks.length > 0) && (
          <div className="border-t border-[var(--line-soft)] px-4 py-3">
            {detail.depends_on.length > 0 && (
              <>
                <div className="mb-1 text-xs text-slate-600">Depends on</div>
                {detail.depends_on.map((r) => (
                  <div key={r.id} className="mb-1 text-xs text-slate-400">
                    #{r.id} [{r.status}] {r.title}
                  </div>
                ))}
              </>
            )}
            {detail.blocks.length > 0 && (
              <>
                <div className="mb-1 mt-2 text-xs text-slate-600">Blocks</div>
                {detail.blocks.map((r) => (
                  <div key={r.id} className="mb-1 text-xs text-slate-400">
                    #{r.id} [{r.status}] {r.title}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* comments / handoff notes */}
        <div className="border-t border-[var(--line-soft)] px-4 py-3">
          <div className="mb-2 text-xs text-slate-600">Comments / Handoff notes</div>
          {detail.comments.map((c) => (
            <div key={c.id} className="mb-3 rounded-md bg-[var(--panel-2)] p-2.5">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-slate-400">{c.author}</span>
                <span className="text-[10px] text-slate-700">{c.created_at.slice(0, 16)}</span>
              </div>
              <div className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                {c.body}
              </div>
            </div>
          ))}
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Add a comment or handoff note…"
            className="mb-2 w-full resize-none rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-xs text-slate-300 outline-none focus:border-sky-600"
          />
          <button
            onClick={handleAddComment}
            disabled={saving || !comment.trim()}
            className="rounded bg-[var(--line-soft)] px-3 py-1 text-xs text-slate-300 hover:bg-[var(--line)] disabled:opacity-40"
          >
            Add comment
          </button>
        </div>

        {/* activity */}
        <div className="border-t border-[var(--line-soft)] px-4 py-3">
          <div className="mb-2 text-xs text-slate-600">Activity</div>
          {detail.events.map((e) => (
            <div key={e.id} className="mb-1 text-[10px] text-slate-600">
              <span className="text-slate-500">{e.created_at.slice(0, 16)}</span>
              {" · "}
              <span className="text-slate-500">{e.actor}</span>
              {" · "}
              {e.kind.replace(/_/g, " ")}
              {e.detail && <span className="text-slate-700"> {e.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function StatusBadge({
  status,
  onChange,
}: {
  status: Status;
  onChange: (s: Status) => void;
}) {
  const COLOR: Record<Status, string> = {
    open: "bg-sky-900/50 text-sky-300",
    waiting: "bg-amber-900/50 text-amber-300",
    in_progress: "bg-violet-900/50 text-violet-300",
    review: "bg-pink-900/50 text-pink-300",
    done: "bg-emerald-900/50 text-emerald-300",
  };
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as Status)}
      className={`cursor-pointer rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${COLOR[status]} border-0 outline-none`}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

function PriorityBadge({
  priority,
  onChange,
}: {
  priority: Priority;
  onChange: (p: string) => void;
}) {
  const COLOR: Record<Priority, string> = {
    low: "text-slate-500",
    normal: "text-sky-400",
    high: "text-amber-400",
    urgent: "text-red-400",
  };
  return (
    <select
      value={priority}
      onChange={(e) => onChange(e.target.value)}
      className={`cursor-pointer rounded bg-transparent text-[10px] font-semibold uppercase ${COLOR[priority]} border-0 outline-none`}
    >
      {(["low", "normal", "high", "urgent"] as Priority[]).map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
