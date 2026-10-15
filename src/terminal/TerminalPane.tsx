// One pane: a shell started in the pane's folder, alive while the pane is
// mounted (also when its folder is hidden), killed when the pane closes.

import { useEffect, useRef, useState } from "react";
import { ptyKill, ptySpawn } from "../api";
import { forgetPty, readyPtyBus } from "../shared/terminal/ptyBus";
import { XtermView, type XtermHandle } from "../shared/terminal/XtermView";

interface Props {
  cwd: string;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  /** Lets the workspace clear or focus this terminal. */
  register: (handle: XtermHandle | null) => void;
}

export function TerminalPane({ cwd, visible, focused, onFocus, register }: Props) {
  const [ptyId, setPtyId] = useState<number | null>(null);
  const [alive, setAlive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const view = useRef<XtermHandle>(null);

  useEffect(() => {
    let id: number | null = null;
    let cancelled = false;
    setError(null);
    readyPtyBus()
      .then(() => ptySpawn(cwd, 100, 30))
      .then((pid) => {
        id = pid;
        if (cancelled) {
          forgetPty(pid);
          return void ptyKill(pid).catch(() => {});
        }
        setPtyId(pid);
        setAlive(true);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
      if (id !== null) {
        forgetPty(id);
        void ptyKill(id).catch(() => {});
      }
      setPtyId(null);
    };
  }, [cwd, generation]);

  useEffect(() => {
    register(view.current);
    return () => register(null);
  });

  useEffect(() => {
    if (visible && focused) view.current?.focus();
  }, [visible, focused, ptyId]);

  return (
    <div className="relative h-full w-full" onMouseDown={onFocus}>
      {ptyId !== null && <XtermView key={ptyId} ref={view} ptyId={ptyId} visible={visible} onExit={() => setAlive(false)} onFocus={onFocus} />}
      {(!alive || error) && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 border-t border-[var(--line)] bg-[var(--panel-solid)]/95 px-3 py-2 text-[11.5px]">
          <span className={error ? "text-rose-300" : "text-slate-400"}>{error ?? "The shell exited."}</span>
          <button
            className="btn py-0.5 text-xs"
            autoFocus={focused}
            onClick={() => setGeneration((g) => g + 1)}
            onKeyDown={(e) => e.key === "Enter" && setGeneration((g) => g + 1)}
          >
            Restart
          </button>
        </div>
      )}
    </div>
  );
}
