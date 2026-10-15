// Saved folders and connections. Changes are applied locally first and saved;
// a rejected save (validation) rolls back and reports why.

import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../k8s/api";
import { db } from "../api";
import type { ConnectionsFile } from "../types";

/** Keeps every open Database tab in step after one of them saves. */
const CHANGED = "db-connections-changed";

const EMPTY: ConnectionsFile = { folders: [], connections: [], relay_pod: "" };

export function useConnections() {
  const [file, setFile] = useState<ConnectionsFile>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.load()
      .then((f) => setFile(f))
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoaded(true));
    const onChange = (e: Event) => setFile((e as CustomEvent<ConnectionsFile>).detail);
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, []);

  /** Save a new version; resolves false (and keeps the old one) when rejected. */
  const save = useCallback(
    async (next: ConnectionsFile): Promise<boolean> => {
      const previous = file;
      setFile(next);
      try {
        await db.save(next);
        setError(null);
        window.dispatchEvent(new CustomEvent(CHANGED, { detail: next }));
        return true;
      } catch (e) {
        setFile(previous);
        setError(errorText(e));
        return false;
      }
    },
    [file],
  );

  const reload = useCallback(() => db.load().then(setFile).catch((e) => setError(errorText(e))), []);

  return { file, loaded, error, setError, save, reload };
}
