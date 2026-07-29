import { useState } from "react";
import packageJson from "../../package.json";
import type { ProjectSummary } from "../types";
import { ProjectLinkPanel } from "./tp/ProjectLinkPanel";

interface SidebarProps {
  projects: ProjectSummary[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onDeleteProject: (id: number) => void;
  onNewProject: () => void;
  onProjectChanged: () => void;
  onOpenSettings: () => void;
}

export function Sidebar({
  projects,
  selectedId,
  onSelect,
  onDeleteProject,
  onNewProject,
  onProjectChanged,
  onOpenSettings,
}: SidebarProps) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const totalActive = projects.reduce(
    (sum, p) => sum + p.open + p.waiting + p.in_progress + p.review,
    0,
  );

  const confirmProject = confirmId !== null ? projects.find((p) => p.id === confirmId) : null;
  const menuProject = menuId !== null ? projects.find((p) => p.id === menuId) : null;

  const filtered = query.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : projects;

  function handleConfirm() {
    if (confirmId !== null) {
      onDeleteProject(confirmId);
      setConfirmId(null);
      setMenuId(null);
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
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="mb-2 mx-2 w-auto rounded-md border border-[#2a3040] bg-[#0b0e14] px-2 py-1 text-xs text-slate-300 outline-none placeholder:text-slate-700 focus:border-sky-600"
        />
        {filtered.map((p) => (
          <SidebarItem
            key={p.id}
            label={p.name}
            count={p.open + p.waiting + p.in_progress + p.review}
            inProgress={p.in_progress > 0}
            selected={selectedId === p.id}
            linkedStoryId={p.tp_user_story_id}
            onClick={() => onSelect(p.id)}
            onOpenMenu={() => setMenuId(p.id)}
            title={p.path}
          />
        ))}
        {filtered.length === 0 && (
          <p className="px-2 py-2 text-xs leading-relaxed text-slate-600">
            {projects.length === 0
              ? "No projects yet. Create a task here, or let an AI plan one from its CLI."
              : "No projects match your search."}
          </p>
        )}
      </nav>

      {menuProject && !confirmProject && (
        <ProjectMenu
          project={menuProject}
          onClose={() => setMenuId(null)}
          onDelete={() => setConfirmId(menuProject.id)}
          onChanged={onProjectChanged}
          onOpenSettings={() => {
            setMenuId(null);
            onOpenSettings();
          }}
        />
      )}

      {confirmProject && (
        <ConfirmDialog
          project={confirmProject}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmId(null)}
        />
      )}
      <div className="shrink-0 border-t border-[#1c2230] px-4 py-2">
        <p className="text-[10px] text-slate-700">v{packageJson.version}</p>
      </div>
    </aside>
  );
}

interface ProjectMenuProps {
  project: ProjectSummary;
  onClose: () => void;
  onDelete: () => void;
  onChanged: () => void;
  onOpenSettings: () => void;
}

/** Per-project settings: the TargetProcess link, and deleting the project. */
function ProjectMenu({
  project,
  onClose,
  onDelete,
  onChanged,
  onOpenSettings,
}: ProjectMenuProps) {
  const total =
    project.open + project.waiting + project.in_progress + project.review + project.done;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-lg border border-[#2a3040] bg-[#0d1018] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="truncate text-sm font-semibold text-slate-200">{project.name}</p>
          <p className="truncate text-[10px] text-slate-600">{project.path}</p>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
            TargetProcess
          </p>
          <ProjectLinkPanel
            project={project}
            onChanged={onChanged}
            onOpenSettings={onOpenSettings}
          />
        </div>

        <div className="flex items-center justify-between border-t border-[#1c2230] pt-3">
          <button
            onClick={onDelete}
            className="rounded border border-red-900/60 px-2.5 py-1 text-[11px] text-red-400 hover:bg-red-950/40"
          >
            Delete project{total > 0 && ` and ${total} task${total === 1 ? "" : "s"}`}
          </button>
          <button
            onClick={onClose}
            className="text-[11px] text-slate-500 hover:text-slate-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  project: ProjectSummary;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({ project, onConfirm, onCancel }: ConfirmDialogProps) {
  const total =
    project.open + project.waiting + project.in_progress + project.review + project.done;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-[#2a3040] bg-[#0d1018] p-4 shadow-xl">
        <p className="mb-1 text-sm font-semibold text-slate-200">Delete project?</p>
        <p className="mb-3 text-xs leading-relaxed text-slate-400">
          <span className="font-medium text-slate-300">"{project.name}"</span> and{" "}
          <span className="font-medium text-slate-300">
            {total === 0 ? "no tasks" : `all ${total} of its task${total === 1 ? "" : "s"}`}
          </span>{" "}
          will be permanently deleted. This cannot be undone.
        </p>
        {project.tp_user_story_id !== null && (
          <p className="mb-3 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1.5 text-[10px] leading-relaxed text-amber-500">
            Nothing is deleted in TargetProcess — user story #{project.tp_user_story_id} and any
            entities already created under it are left as they are.
          </p>
        )}
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
  linkedStoryId?: number | null;
  onClick: () => void;
  onOpenMenu?: () => void;
}

function SidebarItem({
  label,
  count,
  selected,
  inProgress,
  title,
  linkedStoryId,
  onClick,
  onOpenMenu,
}: SidebarItemProps) {
  return (
    <div className="group relative flex items-center">
      <button
        onClick={onClick}
        title={title}
        className={`flex flex-1 items-center justify-between rounded-md px-2 py-1.5 pr-7 text-left text-sm transition-colors ${
          selected ? "bg-[#1b2232] text-slate-100" : "text-slate-400 hover:bg-[#141927]"
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-col truncate">
          <span className="flex items-center gap-1.5 truncate">
            {inProgress && (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-400" />
            )}
            <span className="truncate">{label}</span>
            {linkedStoryId != null && (
              <span
                title={`Linked to TargetProcess user story #${linkedStoryId}`}
                className="shrink-0 font-mono text-[9px] text-sky-600"
              >
                TP
              </span>
            )}
          </span>
          {title && <span className="truncate text-[10px] text-slate-600">{title}</span>}
        </span>
        {count > 0 && <span className="ml-2 shrink-0 text-xs text-slate-500">{count}</span>}
      </button>
      {onOpenMenu && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu();
          }}
          title="Project settings — TargetProcess link, delete"
          className="absolute right-1 flex h-5 w-5 items-center justify-center rounded text-slate-600 transition-colors hover:bg-[#1b2232] hover:text-slate-200"
        >
          ⋯
        </button>
      )}
    </div>
  );
}
