// ⌘K entries for the Kubernetes workspace: environments, resource kinds and
// the objects in the current list (with "logs of" / "shell into" for pods).

import { useMemo } from "react";
import { IconCube, IconSearch } from "../../shared/icons";
import type { PaletteEntry } from "../../shared/Palette";
import type { DetailTab } from "../components/DetailPanel";
import { ALL_KINDS, kindLabel } from "../kinds";
import { parseEnvKey } from "../logic/envSearch";
import type { EnvRef, K8sObject, ResourceKind } from "../types";

interface Args {
  env: EnvRef | null;
  kind: ResourceKind;
  objects: K8sObject[];
  recents: string[];
  favourites: string[];
  pickEnv: (env: EnvRef) => void;
  openSearch: () => void;
  changeKind: (kind: ResourceKind) => void;
  openObject: (uid: string, tab: DetailTab) => void;
}

export function usePaletteEntries({ env, kind, objects, recents, favourites, pickEnv, openSearch, changeKind, openObject }: Args): PaletteEntry[] {
  return useMemo(() => {
    const entries: PaletteEntry[] = [
      { id: "switch", label: "Switch environment…", hint: "⌘E", group: "Commands", icon: <IconSearch size={14} />, run: openSearch },
    ];
    const envKeys = [...favourites, ...recents.filter((r) => !favourites.includes(r))].slice(0, 12);
    for (const key of envKeys) {
      const e = parseEnvKey(key);
      if (!e) continue;
      entries.push({
        id: `env:${key}`,
        label: e.namespace,
        detail: e.context,
        group: "Environments",
        keywords: "env switch",
        icon: <span className="text-amber-300">{favourites.includes(key) ? "★" : "↺"}</span>,
        run: () => pickEnv(e),
      });
    }
    if (env) {
      ALL_KINDS.forEach((k, i) =>
        entries.push({
          id: `kind:${k.kind}`,
          label: k.label,
          hint: i < 9 ? `⌃⌘${i + 1}` : undefined,
          group: "Resources",
          icon: <IconCube size={14} />,
          run: () => changeKind(k.kind),
        }),
      );
      for (const o of objects.slice(0, 400)) {
        const uid = o.metadata.uid;
        entries.push({ id: `obj:${uid}`, label: o.metadata.name, detail: kindLabel(kind), group: kindLabel(kind), run: () => openObject(uid, "overview") });
        if (kind === "pods") {
          entries.push({ id: `logs:${uid}`, label: `Logs of ${o.metadata.name}`, group: "Pod actions", keywords: "log tail", run: () => openObject(uid, "logs") });
          entries.push({ id: `shell:${uid}`, label: `Shell into ${o.metadata.name}`, group: "Pod actions", keywords: "exec terminal bash", run: () => openObject(uid, "shell") });
        }
      }
    }
    return entries;
  }, [env, kind, objects, recents, favourites, pickEnv, openSearch, changeKind, openObject]);
}
