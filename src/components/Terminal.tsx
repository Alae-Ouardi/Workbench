import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { onPtyExit, onPtyOutput, ptyKill, ptyResize, ptySpawn, ptyWrite } from "../api";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface Tab {
  id: number;
  cwd: string;
  label: string;
  alive: boolean;
}

interface TerminalPanelProps {
  defaultCwd: string;
}

export function TerminalPanel({ defaultCwd }: TerminalPanelProps) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);

  async function openTab(cwd: string) {
    const label = cwd.split("/").pop() ?? cwd;
    const ptyId = await ptySpawn(cwd, 80, 24);
    const tab: Tab = { id: ptyId, cwd, label, alive: true };
    setTabs((prev) => [...prev, tab]);
    setActive(ptyId);
  }

  useEffect(() => {
    if (tabs.length === 0) {
      openTab(defaultCwd);
    }
  }, []);

  function closeTab(ptyId: number) {
    ptyKill(ptyId).catch(() => {});
    setTabs((prev) => prev.filter((t) => t.id !== ptyId));
    setActive((prev) => {
      if (prev !== ptyId) return prev;
      const remaining = tabs.filter((t) => t.id !== ptyId);
      return remaining[remaining.length - 1]?.id ?? null;
    });
  }

  return (
    <div className="flex h-full flex-col bg-[#0b0e14]">
      {/* tab bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-[#1c2230] px-2 py-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs ${
              active === tab.id
                ? "bg-[#1c2230] text-slate-200"
                : "text-slate-600 hover:text-slate-400"
            } ${!tab.alive ? "opacity-50" : ""}`}
          >
            <button onClick={() => setActive(tab.id)} className="flex items-center gap-1.5">
              <span>{tab.alive ? "▸" : "□"}</span>
              <span>{tab.label}</span>
            </button>
            <button
              onClick={() => closeTab(tab.id)}
              className="ml-1 text-slate-700 hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => openTab(defaultCwd)}
          className="rounded px-2 py-0.5 text-xs text-slate-700 hover:text-slate-300"
          title="New terminal"
        >
          +
        </button>
      </div>

      {/* terminal panes */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.map((tab) => (
          <TermPane
            key={tab.id}
            ptyId={tab.id}
            visible={active === tab.id}
            onDead={() =>
              setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, alive: false } : t)))
            }
          />
        ))}
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-slate-700">
            No terminal open
          </div>
        )}
      </div>
    </div>
  );
}

interface TermPaneProps {
  ptyId: number;
  visible: boolean;
  onDead: () => void;
}

function TermPane({ ptyId, visible, onDead }: TermPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      theme: {
        background: "#0b0e14",
        foreground: "#d6dbe5",
        cursor: "#7e9cd8",
        selectionBackground: "#2d4f67",
      },
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    term.onData((data) => {
      ptyWrite(ptyId, data).catch(console.error);
    });

    let unlistenOutput: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    onPtyOutput((output) => {
      if (output.id !== ptyId) return;
      term.write(new Uint8Array(output.data));
    }).then((fn) => {
      unlistenOutput = fn;
    });

    onPtyExit((id) => {
      if (id !== ptyId) return;
      term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n");
      onDead();
    }).then((fn) => {
      unlistenExit = fn;
    });

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      ptyResize(ptyId, term.cols, term.rows).catch(() => {});
    });
    resizeObserver.observe(container);

    return () => {
      unlistenOutput?.();
      unlistenExit?.();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [ptyId]);

  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      fitRef.current.fit();
      ptyResize(ptyId, termRef.current.cols, termRef.current.rows).catch(() => {});
      termRef.current.focus();
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
