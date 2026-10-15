import { useCallback, useState } from "react";

/** Small per-viewer UI state (selected sprint, filters…) kept across launches. */
export function useLocalState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the value still applies for this session.
      }
    },
    [key],
  );
  return [value, set];
}
