import { useState } from "react";
import type { ProjectSummary } from "../types";

interface SidebarProps {
  projects: ProjectSummary[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onDeleteProject: (id: number) => void;
  onNewProject: () => void;
}

export function Sidebar({ projects, selectedId, onSelect, onDeleteProject, onNewProject }: SidebarProps) {
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const totalActive = projects.reduce(
    (sum, p) => sum + p.open + p.waiting + p.in_progress + p.review,
    0,
  );

  const confirmProject = confirmId !== null ? projects.find((p) => p.id === confirmId) : null;

  function handleDeleteClick(id: number) {
    setConfirmId(id);
  }

  function handleConfirm() {
    if (confirmId !== null) {
      onDeleteProject(confirmId);
      setConfirmId(null);
    }
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[#1c2230] bg-[#0d1018]">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="text-lg">🗂️</span>
        <span className="text-sm font-bold tracking-wide text-slate-200">TaskBoard</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        <SidebarItem
          label="All projects"
          count={totalActive}
          selected={selectedId === null}
          onClick={() => onSelect(null)}
        />
        <div className="mt-3 mb-1 flex items-center justify-between px-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            Projects
          </span>
          <button
            onClick={onNewProject}
            className="text-[10px] text-slate-600 hover:text-sky-400"
            title="New project"
          >
            + New
          </button>
        </div>
        {projects.map((p) => (
          <SidebarItem
            key={p.id}
            label={p.name}
            count={p.open + p.waiting + p.in_progress + p.review}
            inProgress={p.in_progress > 0}
            selected={selectedId === p.id}
            onClick={() => onSelect(p.id)}
            onDelete={() => handleDeleteClick(p.id)}
            title={p.path}
          />
        ))}
        {projects.length === 0 && (
          <p className="px-2 py-2 text-xs leading-relaxed text-slate-600">
            No projects yet. Create a task here, or let an AI plan one from its CLI.
          </p>
        )}
      </nav>

      {confirmProject && (
        <ConfirmDialog
          projectName={confirmProject.name}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmId(null)}
        />
      )}
    </aside>
  );
}

interface ConfirmDialogProps {
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ projectName, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 rounded-lg border border-[#2a3040] bg-[#0d1018] p-4 shadow-xl">
        <p className="mb-1 text-sm font-semibold text-slate-200">Delete project?</p>
        <p className="mb-4 text-xs text-slate-400">
          <span className="font-medium text-slate-300">"{projectName}"</span> and all its tasks
          will be permanently deleted.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onConfirm}
            className="flex-1 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
          >
            Delete
          </button>
          <button
            onClick={onCancel}
            className="flex-1 rounded border border-[#2a3040] px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface SidebarItemProps {
  label: string;
  count: number;
  selected: boolean;
  inProgress?: boolean;
  title?: string;
  onClick: () => void;
  onDelete?: () => void;
}

function SidebarItem({ label, count, selected, inProgress, title, onClick, onDelete }: SidebarItemProps) {
  return (
    <div className="group relative flex items-center">
      <button
        onClick={onClick}
        title={title}
        className={`flex flex-1 items-center justify-between rounded-md px-2 py-1.5 pr-7 text-left text-sm transition-colors ${
          selected ? "bg-[#1b2232] text-slate-100" : "text-slate-400 hover:bg-[#141927]"
        }`}
      >
        <span className="flex items-center gap-1.5 truncate">
          {inProgress && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-400" />}
          <span className="truncate">{label}</span>
        </span>
        {count > 0 && <span className="ml-2 shrink-0 text-xs text-slate-500">{count}</span>}
      </button>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete project"
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-slate-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}
