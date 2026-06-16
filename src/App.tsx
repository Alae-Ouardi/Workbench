import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  createTask,
  deleteProject,
  listProjects,
  listTasks,
  onBoardChanged,
  onProjectAllDone,
  setStatus,
  type ProjectAllDone,
} from "./api";
import { Board } from "./components/Board";
import { ContextBanner } from "./components/ContextBanner";
import { ProjectDoneBanner } from "./components/ProjectDoneBanner";
import { NewProjectModal } from "./components/NewProjectModal";
import { NewTaskModal } from "./components/NewTaskModal";
import { Sidebar } from "./components/Sidebar";
import { TaskDrawer } from "./components/TaskDrawer";
import { TerminalPanel } from "./components/Terminal";
import type { NewTaskInput, Project, ProjectSummary, Status, Task } from "./types";

type Panel = "board" | "terminal";

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [openTaskId, setOpenTaskId] = useState<number | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [panel, setPanel] = useState<Panel>("board");
  const [terminalCwd, setTerminalCwd] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [doneBanners, setDoneBanners] = useState<ProjectAllDone[]>([]);
  const unlistenRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    const [p, t] = await Promise.all([listProjects(), listTasks(selectedProjectId)]);
    setProjects(p);
    setTasks(t);
    setRefreshKey((k) => k + 1);
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
    return () => {
      unlisten?.();
    };
  }, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onProjectAllDone((payload) => {
      setDoneBanners((prev) =>
        prev.some((b) => b.projectId === payload.projectId) ? prev : [...prev, payload]
      );
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  async function handleMove(id: number, status: Status) {
    const result = await setStatus(id, status);
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === result.task.id) return result.task;
        const promoted = result.promoted.find((p) => p.id === t.id);
        return promoted ?? t;
      }),
    );
  }

  async function handleCreateTask(input: NewTaskInput) {
    await createTask(input);
    await refresh();
  }

  async function handleDeleteProject(id: number) {
    await deleteProject(id);
    if (selectedProjectId === id) setSelectedProjectId(null);
    await refresh();
  }

  async function handleProjectCreated(project: Project) {
    setShowNewProject(false);
    await refresh();
    setSelectedProjectId(project.id);
  }

  function handleSelectProject(id: number | null) {
    setSelectedProjectId(id);
    const project = id !== null ? projects.find((p) => p.id === id) : null;
    if (project) setTerminalCwd(project.path);
  }

  const selectedProject =
    selectedProjectId !== null ? projects.find((p) => p.id === selectedProjectId) : null;

  const visibleTasks =
    selectedProjectId !== null ? tasks.filter((t) => t.project_id === selectedProjectId) : tasks;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={handleSelectProject}
        onDeleteProject={handleDeleteProject}
        onNewProject={() => setShowNewProject(true)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* top bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#1c2230] px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-300">
              {selectedProject?.name ?? "All projects"}
            </span>
            {selectedProject && (
              <span className="text-xs text-slate-600">{selectedProject.path}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <PanelToggle active={panel} onChange={setPanel} />
            <button
              onClick={() => setShowNewTask(true)}
              className="rounded-md bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-600"
            >
              + New task
            </button>
          </div>
        </div>

        {/* content area */}
        <div className="flex flex-1 overflow-hidden">
          {panel === "board" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              {doneBanners.map((banner) => (
                <ProjectDoneBanner
                  key={banner.projectId}
                  projectName={banner.projectName}
                  onDismiss={() =>
                    setDoneBanners((prev) => prev.filter((b) => b.projectId !== banner.projectId))
                  }
                />
              ))}
              {selectedProjectId !== null && (
                <ContextBanner
                  projectId={selectedProjectId}
                  refreshKey={refreshKey}
                  onResume={(id) => setOpenTaskId(id)}
                />
              )}
              <div className="flex-1 overflow-hidden">
                <Board
                  tasks={visibleTasks}
                  showProject={selectedProjectId === null}
                  onMove={handleMove}
                  onOpen={(id) => setOpenTaskId(id)}
                />
              </div>
            </div>
          )}

          {panel === "terminal" && (
            <div className="flex-1 overflow-hidden">
              <TerminalPanel defaultCwd={terminalCwd || "~"} />
            </div>
          )}

          {openTaskId !== null && (
            <TaskDrawer
              taskId={openTaskId}
              onClose={() => setOpenTaskId(null)}
              onRefresh={refresh}
            />
          )}
        </div>
      </div>

      {showNewTask && (
        <NewTaskModal
          projects={projects}
          defaultProjectId={selectedProjectId}
          onSubmit={handleCreateTask}
          onClose={() => setShowNewTask(false)}
        />
      )}

      {showNewProject && (
        <NewProjectModal
          onCreated={handleProjectCreated}
          onClose={() => setShowNewProject(false)}
        />
      )}
    </div>
  );
}

function PanelToggle({ active, onChange }: { active: Panel; onChange: (p: Panel) => void }) {
  return (
    <div className="flex rounded-md border border-[#2a3040] p-0.5">
      {(["board", "terminal"] as Panel[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={`rounded px-3 py-0.5 text-xs transition-colors ${
            active === p ? "bg-[#1c2230] text-slate-200" : "text-slate-600 hover:text-slate-400"
          }`}
        >
          {p === "board" ? "Board" : "Terminal"}
        </button>
      ))}
    </div>
  );
}
