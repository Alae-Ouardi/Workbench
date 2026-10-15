import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { tpwGetPrefs, tpwSavePrefs } from "./api";
import type { WorkspacePrefs } from "./types";

export const DEFAULT_PREFS: WorkspacePrefs = {
  default_project_ids: [],
  project_colors: {},
  refresh_minutes: 10,
  daily_target_hours: 8,
  weekly_target_hours: 40,
  monthly_target_hours: null,
  working_days: [1, 2, 3, 4, 5],
  theme: "dark",
};

interface PrefsContextValue {
  prefs: WorkspacePrefs;
  savePrefs: (next: WorkspacePrefs) => Promise<void>;
}

const PrefsContext = createContext<PrefsContextValue>({
  prefs: DEFAULT_PREFS,
  savePrefs: async () => {},
});

function applyTheme(theme: WorkspacePrefs["theme"]): () => void {
  const root = document.documentElement;
  if (theme !== "system") {
    root.dataset.theme = theme;
    return () => {};
  }
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const sync = () => (root.dataset.theme = media.matches ? "light" : "dark");
  sync();
  media.addEventListener("change", sync);
  return () => media.removeEventListener("change", sync);
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<WorkspacePrefs>(DEFAULT_PREFS);

  useEffect(() => {
    tpwGetPrefs()
      .then(setPrefs)
      .catch((e) => console.error("could not load workspace preferences", e));
  }, []);

  useEffect(() => applyTheme(prefs.theme), [prefs.theme]);

  const savePrefs = useCallback(async (next: WorkspacePrefs) => {
    setPrefs(await tpwSavePrefs(next));
  }, []);

  return <PrefsContext.Provider value={{ prefs, savePrefs }}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  return useContext(PrefsContext);
}

export { useLocalState } from "../shared/useLocalState";
