// A terminal bound to one PTY session: renders output, sends keystrokes,
// follows its container's size. Shared by the Terminal workspace, the
// Kubernetes shell and the TaskBoard terminal panel.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { ptyResize, ptyWrite } from "../../api";
import { subscribePty } from "./ptyBus";

export interface XtermHandle {
  focus: () => void;
  clear: () => void;
}

interface Props {
  ptyId: number;
  /** Hidden views keep their session but skip resizing. */
  visible?: boolean;
  onExit?: () => void;
  onFocus?: () => void;
  className?: string;
}

/** Night Owl (Sarah Drasner's theme), the default for every terminal. */
export const NIGHT_OWL = {
  background: "#011627",
  foreground: "#d6deeb",
  cursor: "#80a4c2",
  cursorAccent: "#011627",
  selectionBackground: "#1d3b53",
  black: "#011627",
  red: "#ef5350",
  green: "#22da6e",
  yellow: "#addb67",
  blue: "#82aaff",
  magenta: "#c792ea",
  cyan: "#21c7a8",
  white: "#ffffff",
  brightBlack: "#575656",
  brightRed: "#ef5350",
  brightGreen: "#22da6e",
  brightYellow: "#ffeb95",
  brightBlue: "#82aaff",
  brightMagenta: "#c792ea",
  brightCyan: "#7fdbca",
  brightWhite: "#ffffff",
};

export const XtermView = forwardRef<XtermHandle, Props>(function XtermView(
  { ptyId, visible = true, onExit, onFocus, className = "" },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const handlers = useRef({ onExit, onFocus });
  handlers.current = { onExit, onFocus };

  const resize = () => {
    const el = host.current;
    // A hidden (display:none) view has no size: fitting it would shrink the shell.
    if (!el || !term.current || !fit.current || el.offsetWidth === 0) return;
    fit.current.fit();
    ptyResize(ptyId, term.current.cols, term.current.rows).catch(() => {});
  };

  useEffect(() => {
    const el = host.current!;
    const t = new XTerm({
      theme: NIGHT_OWL,
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      macOptionIsMeta: true,
      scrollback: 10000,
      allowProposedApi: true,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
    term.current = t;
    fit.current = f;
    resize();

    const input = t.onData((data) => void ptyWrite(ptyId, data).catch(() => {}));
    const focusIn = () => handlers.current.onFocus?.();
    t.textarea?.addEventListener("focus", focusIn);
    const unsubscribe = subscribePty(ptyId, {
      onData: (bytes) => t.write(bytes),
      onExit: () => {
        t.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
        handlers.current.onExit?.();
      },
    });
    const observer = new ResizeObserver(() => resize());
    observer.observe(el);
    return () => {
      unsubscribe();
      input.dispose();
      t.textarea?.removeEventListener("focus", focusIn);
      observer.disconnect();
      t.dispose();
      term.current = null;
    };
    // One terminal per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptyId]);

  useEffect(() => {
    if (visible) resize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useImperativeHandle(ref, () => ({
    focus: () => term.current?.focus(),
    clear: () => term.current?.clear(),
  }));

  return <div ref={host} className={`h-full w-full overflow-hidden ${className}`} style={{ display: visible ? "block" : "none" }} />;
});
