// Actions for the selected object. Every change goes through the shared
// confirmation dialog, which names the cluster, namespace and object.

import { useState } from "react";
import { useConfirm } from "../../shared/confirm/ConfirmProvider";
import { errorText, k8s } from "../api";
import type { EnvRef, K8sObject, ResourceKind } from "../types";

const SCALABLE: ResourceKind[] = ["deployments", "statefulsets"];
const RESTARTABLE: ResourceKind[] = ["deployments", "statefulsets", "daemonsets"];
const FORWARDABLE: ResourceKind[] = ["pods", "services"];
const DELETABLE: ResourceKind[] = ["pods", "deployments", "statefulsets", "daemonsets", "jobs", "cronjobs", "services", "ingresses", "configmaps", "secrets", "persistentvolumeclaims"];

interface Props {
  env: EnvRef;
  kind: ResourceKind;
  obj: K8sObject;
  onDone: (message: string) => void;
  onError: (message: string) => void;
  onForward: () => void;
}

const singular = (kind: ResourceKind) => kind.replace(/ies$/, "y").replace(/sses$/, "ss").replace(/s$/, "");

export function Actions({ env, kind, obj, onDone, onError, onForward }: Props) {
  const confirm = useConfirm();
  const [scaling, setScaling] = useState(false);
  const [replicas, setReplicas] = useState<number>(obj.spec?.replicas ?? 1);
  const name = obj.metadata.name;
  const target = { ...env, kind, name };
  const where = [
    { label: "cluster", value: env.context },
    { label: "namespace", value: env.namespace },
    { label: singular(kind), value: name },
  ];

  async function run(title: string, action: () => Promise<string>, opts: { destructive?: boolean; label: string; detail?: string }) {
    const ok = await confirm({
      title,
      target: where,
      envNames: [env.namespace, env.context],
      destructive: opts.destructive,
      confirmLabel: opts.label,
      detail: opts.detail ? <p className="text-[12px] text-slate-400">{opts.detail}</p> : undefined,
    });
    if (!ok) return;
    try {
      const out = await action();
      onDone(out.trim() || `${opts.label} done`);
    } catch (e) {
      onError(errorText(e));
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FORWARDABLE.includes(kind) && (
        <button className="btn py-1 text-xs" onClick={onForward}>
          Port-forward
        </button>
      )}
      {SCALABLE.includes(kind) &&
        (scaling ? (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={500}
              autoFocus
              className="input num w-16 py-1 text-xs"
              value={replicas}
              onChange={(e) => setReplicas(Math.max(0, Number(e.target.value)))}
              onKeyDown={(e) => e.key === "Escape" && setScaling(false)}
            />
            <button
              className="btn btn-primary py-1 text-xs"
              onClick={() => {
                setScaling(false);
                void run(`Scale ${name} from ${obj.spec?.replicas ?? 0} to ${replicas} replicas`, () => k8s.scale(target, replicas), {
                  label: "Scale",
                  destructive: replicas === 0,
                  detail: replicas === 0 ? "Scaling to 0 stops every pod of this workload." : undefined,
                });
              }}
            >
              Scale…
            </button>
          </span>
        ) : (
          <button className="btn py-1 text-xs" onClick={() => setScaling(true)}>
            Scale
          </button>
        ))}
      {RESTARTABLE.includes(kind) && (
        <button
          className="btn py-1 text-xs"
          onClick={() =>
            void run(`Rolling restart of ${name}`, () => k8s.restart(target), {
              label: "Restart",
              detail: "Pods are replaced one by one; the workload stays available if it has more than one replica.",
            })
          }
        >
          Restart
        </button>
      )}
      {DELETABLE.includes(kind) && (
        <button
          className="btn py-1 text-xs text-rose-300 hover:border-rose-500/50"
          onClick={() =>
            void run(`Delete ${singular(kind)} ${name}`, () => k8s.remove(target), {
              label: "Delete",
              destructive: true,
              detail:
                kind === "pods"
                  ? "If a deployment owns this pod, a new one replaces it."
                  : "This cannot be undone from here.",
            })
          }
        >
          Delete
        </button>
      )}
    </div>
  );
}
