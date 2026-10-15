// The kubeconfig's context names, used to tell clients with their own cluster
// from those on the shared one. Read once per launch; the Kubernetes view's
// cached index gives an instant first answer.

import { useEffect, useState } from "react";
import { k8s } from "../k8s/api";

function cachedContexts(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem("k8s.envIndex.v1") ?? "{}");
    return (raw.contexts ?? []).map((c: { name: string }) => c.name);
  } catch {
    return [];
  }
}

let loaded: string[] | null = null;
let loading: Promise<string[]> | null = null;

export function useKnownContexts(): string[] {
  const [list, setList] = useState<string[]>(() => loaded ?? cachedContexts());
  useEffect(() => {
    if (loaded) return;
    loading ??= k8s
      .contexts()
      .then((cs) => (loaded = cs.map((c) => c.name)))
      .catch(() => cachedContexts());
    let cancelled = false;
    void loading.then((names) => !cancelled && setList(names));
    return () => {
      cancelled = true;
    };
  }, []);
  return list;
}
