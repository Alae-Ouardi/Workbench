// App-wide settings, opened from Home: which views are shown, and the
// TargetProcess connection (also reachable from inside TaskBoard).

import { useEffect, useState } from "react";
import { SettingsView } from "../components/SettingsView";
import { useOverlay } from "../shared/overlay";
import { SCREEN_META } from "./AppSwitcher";
import { APP_MODES, toggleView, useHiddenViews, visibleModes } from "./views";

type Section = "views" | "tp";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "views", label: "Views" },
  { id: "tp", label: "TargetProcess" },
];

export function GlobalSettings({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("views");
  useOverlay(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Settings" className="animate-rise flex h-[min(720px,90vh)] w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--panel-solid)] shadow-2xl">
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-[var(--line)] p-3">
          <h2 className="px-2 pb-2 text-sm font-semibold text-slate-100">Settings</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`rounded-lg px-2.5 py-1.5 text-left text-[13px] ${
                section === s.id ? "bg-[rgb(34_211_238/0.12)] text-sky-300" : "text-slate-400 hover:bg-[var(--line-soft)] hover:text-slate-200"
              }`}
            >
              {s.label}
            </button>
          ))}
          <button onClick={onClose} className="mt-auto rounded-lg px-2.5 py-1.5 text-left text-[12px] text-slate-500 hover:text-slate-200">
            Close <kbd className="chip num ml-1">esc</kbd>
          </button>
        </nav>
        <div className="min-w-0 flex-1">{section === "views" ? <ViewsSection /> : <SettingsView />}</div>
      </div>
    </div>
  );
}

function ViewsSection() {
  const hidden = useHiddenViews();
  const lastOne = visibleModes(hidden).length <= 1;

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-base font-semibold text-slate-100">Views</h1>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Turn off the views you don't use. They disappear from Home and the view menu; nothing they hold is deleted, and you can
        turn them back on at any time.
      </p>
      <ul className="mt-5 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
        {APP_MODES.map((mode) => {
          const meta = SCREEN_META[mode];
          const on = !hidden.includes(mode);
          const locked = on && lastOne;
          return (
            <li key={mode} className="flex items-center gap-3 px-4 py-3">
              <span style={{ color: meta.color }}>{meta.icon(16)}</span>
              <span className="flex-1 text-[13px] text-slate-200">{meta.label}</span>
              {locked && <span className="text-[11px] text-slate-500">at least one view stays on</span>}
              <button
                role="switch"
                aria-checked={on}
                aria-label={`Show ${meta.label}`}
                disabled={locked}
                onClick={() => toggleView(mode, on)}
                className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-40 ${on ? "bg-sky-500" : "bg-slate-700"}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
