import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { tpGetSettings } from "../api";
import type { TpUser } from "../types";
import { tpwMe } from "./api";
import { useTpwQuery } from "./hooks/useTpwQuery";
import { todayIso } from "./logic/dates";
import { useLocalState, usePrefs } from "./prefs";
import type { TpProject, TpSprint, TpWorkItem, WorkspaceFilters } from "./types";

export type ConnectionState = "checking" | "ready" | "not_configured";

interface WorkspaceValue {
  connection: ConnectionState;
  me: TpUser | null;
  projects: TpProject[];
  sprints: TpSprint[];
  sprint: TpSprint | null;
  setSprintId: (id: number) => void;
  filters: WorkspaceFilters;
  setFilters: (f: WorkspaceFilters) => void;
  myWork: TpWorkItem[];
  today: string;
  projectColor: (projectId: number | null) => string;
  /** Item opened in the detail drawer. */
  openItem: TpWorkItem | null;
  setOpenItem: (item: TpWorkItem | null) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/** Distinct, readable accents for projects without a chosen colour. */
const PALETTE = ["#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#fbbf24", "#60a5fa", "#fb7185", "#2dd4bf"];

/**
 * The sprint to show by default: one running today, preferring the one most of
 * my work sits in (several teams' sprints usually overlap).
 */
export function pickDefaultSprint(sprints: TpSprint[], myWork: TpWorkItem[], today: string): TpSprint | null {
  const running = sprints.filter(
    (s) => s.start_date !== null && s.end_date !== null && s.start_date <= today && today <= s.end_date,
  );
  const pool = running.length ? running : sprints;
  if (!pool.length) return null;
  const weight = (s: TpSprint) => myWork.filter((i) => i.sprint_id === s.id).length;
  return [...pool].sort((a, b) => weight(b) - weight(a))[0];
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { prefs } = usePrefs();
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [me, setMe] = useState<TpUser | null>(null);
  const [storedSprintId, setSprintId] = useLocalState<number | null>("tpw.sprint", null);
  const [storedFilters, setFilters] = useLocalState<WorkspaceFilters | null>("tpw.filters", null);
  const [openItem, setOpenItem] = useState<TpWorkItem | null>(null);
  const today = todayIso();

  useEffect(() => {
    tpGetSettings()
      .then((s) => {
        const ready = s.token_set && s.base_url_normalized.length > 8;
        setConnection(ready ? "ready" : "not_configured");
        if (ready) tpwMe().then(setMe).catch(() => setMe(null));
      })
      .catch(() => setConnection("not_configured"));
  }, []);

  const enabled = connection === "ready";
  const projectsQ = useTpwQuery<TpProject[]>(enabled ? { kind: "projects" } : null);
  const filters: WorkspaceFilters = storedFilters ?? {
    projectIds: prefs.default_project_ids,
    assigneeId: null,
    text: "",
  };
  // Sprints follow the project filter: a team iteration belongs to a team, so
  // the backend keeps the ones that hold the selected projects' stories.
  const sprintProjectIds = [...filters.projectIds].sort((a, b) => a - b);
  const sprintsQ = useTpwQuery<TpSprint[]>(enabled ? { kind: "sprints", project_ids: sprintProjectIds } : null);
  const myWorkQ = useTpwQuery<TpWorkItem[]>(enabled ? { kind: "my_work" } : null);

  const sprints = sprintsQ.data ?? [];
  const myWork = myWorkQ.data ?? [];
  const sprint =
    sprints.find((s) => s.id === storedSprintId) ?? pickDefaultSprint(sprints, myWork, today);

  const value = useMemo<WorkspaceValue>(() => {
    const projects = projectsQ.data ?? [];
    const order = new Map(projects.map((p, i) => [p.id, i]));
    return {
      connection,
      me,
      projects,
      sprints,
      sprint,
      setSprintId,
      filters,
      setFilters,
      myWork,
      today,
      projectColor: (id) => {
        if (id === null) return "var(--ink-500)";
        return prefs.project_colors[String(id)] ?? PALETTE[(order.get(id) ?? id) % PALETTE.length];
      },
      openItem,
      setOpenItem,
    };
  }, [connection, me, projectsQ.data, sprints, sprint, setSprintId, filters, setFilters, myWork, today, prefs.project_colors, openItem]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
