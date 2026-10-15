// The menu-bar panel: a Today tab (meetings, time, quick log) and the
// TaskBoard task list.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { useMeetings } from "../../meetings/MeetingProvider";
import { requestRefresh } from "../../tp-workspace/hooks/useTpwQuery";
import { LogoMark } from "../../shell/Logo";
import { useLocalState } from "../../tp-workspace/prefs";
import { TrayPopover } from "../TrayPopover";
import { TrayToday } from "./TrayToday";

type Tab = "today" | "tasks";

export function TrayHub() {
  const [tab, setTab] = useLocalState<Tab>("tray.tab", "today");
  const { pending, live } = useMeetings();

  // A meeting just ended: the panel was dropped down to log it.
  useEffect(() => {
    const unlisten = listen("tray-show-today", () => setTab("today"));
    return () => void unlisten.then((u) => u());
  }, [setTab]);

  // Dropped down for meetings to log and all are handled: tuck it away again,
  // unless the user is using the panel.
  const hadPending = useRef(pending.length > 0);
  useEffect(() => {
    if (hadPending.current && pending.length === 0 && !document.hasFocus()) {
      void getCurrentWindow().hide();
    }
    hadPending.current = pending.length > 0;
  }, [pending.length]);

  // Fresh numbers each time the panel is opened.
  useEffect(() => {
    window.addEventListener("focus", requestRefresh);
    return () => window.removeEventListener("focus", requestRefresh);
  }, []);

  const badge = pending.length > 0 ? pending.length : live.active ? "●" : null;

  return (
    <div className="flex h-screen flex-col bg-[var(--panel)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-3 pt-2.5 pb-2">
        <span className="mr-1.5 flex items-center gap-1.5" title="Workbench">
          <LogoMark size={20} glow={false} />
        </span>
        {(["today", "tasks"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-[11.5px] ${
              tab === t ? "bg-[rgb(34_211_238/0.12)] text-sky-200" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t === "today" ? "Today" : "Tasks"}
            {t === "today" && badge !== null && (
              <span className={`num rounded px-1 text-[9.5px] ${live.active && !pending.length ? "text-rose-300" : "bg-sky-500/20 text-sky-200"}`}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab === "today" ? <TrayToday /> : <TrayPopover />}
      <div className="flex shrink-0 items-center gap-1 border-t border-white/[0.06] px-3 py-1.5 text-[11px]">
        <button className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/[0.06] hover:text-slate-100" onClick={() => void invoke("show_main_window")}>
          Open Workbench
        </button>
        <button className="ml-auto rounded-md px-2 py-1 text-slate-500 hover:bg-white/[0.06] hover:text-rose-300" onClick={() => void invoke("quit_app")}>
          Quit
        </button>
      </div>
    </div>
  );
}
