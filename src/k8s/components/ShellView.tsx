// Interactive shell inside a container, in the embedded terminal.

import { forgetPty, readyPtyBus } from "../../shared/terminal/ptyBus";
import { useEffect, useState } from "react";
import { useConfirm } from "../../shared/confirm/ConfirmProvider";
import { envTier, isProdLike } from "../../shared/envKind";
import { ptyKill } from "../../api";
import { TermPane } from "../../components/Terminal";
import { errorText, k8s } from "../api";
import type { EnvRef, K8sObject } from "../types";

export function ShellView({ env, pod }: { env: EnvRef; pod: K8sObject }) {
  const containers: string[] = (pod.spec?.containers ?? []).map((c: { name: string }) => c.name);
  const [container, setContainer] = useState(containers[0] ?? "");
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [alive, setAlive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState(0);
  const running = pod.status?.phase === "Running";
  const confirm = useConfirm();
  // On production a shell is opened only after an explicit confirmation.
  const prod = isProdLike(envTier(env.namespace, env.context));
  const [allowed, setAllowed] = useState(!prod);

  useEffect(() => {
    if (!running || !container || !allowed) return;
    let id: number | null = null;
    let cancelled = false;
    setError(null);
    readyPtyBus()
      .then(() => k8s.exec(env, pod.metadata.name, container, 100, 30))
      .then((pid) => {
        id = pid;
        if (cancelled) {
          forgetPty(pid);
          return void ptyKill(pid).catch(() => {});
        }
        setPtyId(pid);
        setAlive(true);
      })
      .catch((e) => !cancelled && setError(errorText(e)));
    return () => {
      cancelled = true;
      setPtyId(null);
      if (id !== null) {
        forgetPty(id);
        void ptyKill(id).catch(() => {});
      }
    };
  }, [env.context, env.namespace, pod.metadata.name, container, session, running, allowed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (running && !allowed) {
    return (
      <div className="p-6 text-center">
        <p className="text-xs text-slate-400">This is a production pod. Commands you run in the shell take effect immediately.</p>
        <button
          className="btn mt-4 border-rose-500/50 text-rose-200"
          onClick={() =>
            void confirm({
              title: `Open a shell in ${pod.metadata.name}`,
              target: [
                { label: "cluster", value: env.context },
                { label: "namespace", value: env.namespace },
                { label: "container", value: container },
              ],
              envNames: [env.namespace, env.context],
              confirmLabel: "Open shell",
            }).then((ok) => ok && setAllowed(true))
          }
        >
          Open shell…
        </button>
      </div>
    );
  }

  if (!running) {
    return <p className="p-6 text-center text-xs text-slate-500">The pod is not running, so there is no shell to open.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--line-soft)] px-3 py-2 text-xs">
        {containers.length > 1 && (
          <select className="input w-auto py-1 text-xs" value={container} onChange={(e) => setContainer(e.target.value)}>
            {containers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <span className="num truncate text-slate-500">
          kubectl exec -it {pod.metadata.name} -c {container}
        </span>
        <span className={`ml-auto h-1.5 w-1.5 rounded-full ${alive ? "bg-emerald-400" : "bg-slate-500"}`} />
        <button className="btn py-1 text-xs" onClick={() => setSession((s) => s + 1)}>
          {alive ? "Restart" : "Reconnect"}
        </button>
      </div>
      {error && <p className="m-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      <div className="relative min-h-0 flex-1 bg-[var(--bg)]">
        {ptyId !== null && <TermPane key={ptyId} ptyId={ptyId} visible onDead={() => setAlive(false)} />}
      </div>
    </div>
  );
}
