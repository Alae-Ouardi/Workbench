import { useState } from "react";
import { deleteProject } from "../../api";
import type { ProjectSummary } from "../../types";
import { ProjectLinkPanel } from "../tp/ProjectLinkPanel";

interface TrayProjectMenuProps {
  project: ProjectSummary;
  onClose: () => void;
  onChanged: () => void;
  /** Called after the project is gone, so the popover can pick another. */
  onDeleted: () => void;
}

/**
 * Per-project actions inside the popover: the TargetProcess link, and deleting
 * the project with its tasks — so neither needs the full board.
 */
export function TrayProjectMenu({
  project,
  onClose,
  onChanged,
  onDeleted,
}: TrayProjectMenuProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const total =
    project.open + project.waiting + project.in_progress + project.review + project.done;

  async function remove() {
    setBusy(true);
    try {
      await deleteProject(project.id);
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-[var(--bg)] px-3 py-3">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold text-slate-200">{project.name}</p>
          <p className="truncate text-[10px] text-slate-600">{project.path}</p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-[11px] text-slate-600 hover:text-slate-300"
        >
          Close
        </button>
      </div>

      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
        TargetProcess
      </p>
      <div className="mb-3">
        <ProjectLinkPanel project={project} onChanged={onChanged} />
      </div>

      {confirming ? (
        <div className="rounded-lg bg-red-500/[0.07] p-2.5">
          <p className="mb-2 text-[11px] leading-relaxed text-slate-300">
            Delete <span className="font-semibold">{project.name}</span> and{" "}
            {total === 0 ? "no tasks" : `all ${total} task${total === 1 ? "" : "s"}`}? This cannot
            be undone.
            {project.tp_user_story_id !== null && (
              <span className="mt-1 block text-[10px] text-amber-500">
                Nothing is deleted in TargetProcess.
              </span>
            )}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={remove}
              disabled={busy}
              className="flex-1 rounded-lg bg-red-600 py-1.5 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete project"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg px-2.5 py-1.5 text-[11px] text-slate-500 hover:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="w-full rounded-lg border border-red-900/50 py-1.5 text-[11px] text-red-400 transition-colors hover:bg-red-500/10"
        >
          Delete project{total > 0 && ` and ${total} task${total === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}
