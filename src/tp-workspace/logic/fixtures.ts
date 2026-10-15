// Test builders. Not imported by app code.

import type { TpTimeEntry, TpWorkItem } from "../types";

export function item(overrides: Partial<TpWorkItem> & { id: number }): TpWorkItem {
  return {
    entity_type: "UserStory",
    name: `Item ${overrides.id}`,
    state: { id: 1, name: "Open", is_final: false, numeric_priority: 0 },
    project_id: 3,
    project_name: "Evo",
    process_id: 9,
    team_name: "Core",
    sprint_id: 133,
    sprint_name: "Sprint 133",
    sprint_end_date: null,
    user_story_id: null,
    user_story_name: "",
    effort: 0,
    effort_completed: 0,
    effort_to_do: 0,
    time_spent: 0,
    time_remain: 0,
    planned_end_date: null,
    end_date: null,
    start_date: null,
    modify_date: null,
    assigned: [],
    tags: [],
    ...overrides,
  };
}

export const DONE = { id: 9, name: "Done", is_final: true, numeric_priority: 9 };
export const IN_PROGRESS = { id: 5, name: "In Progress", is_final: false, numeric_priority: 2 };

export function time(overrides: Partial<TpTimeEntry> & { id: number; date: string; spent: number }): TpTimeEntry {
  return {
    remain: 0,
    description: "",
    entity_id: 42,
    entity_type: "Task",
    entity_name: "Login form",
    project_id: 3,
    project_name: "Evo",
    ...overrides,
  };
}
