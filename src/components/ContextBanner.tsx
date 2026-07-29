import { useEffect, useRef, useState } from "react";
import { getBriefing, updateProjectContext } from "../api";
import type { Briefing } from "../types";
import { TpChip } from "./tp/TpChip";

interface ContextBannerProps {
  projectId: number;
  /** Bumped by the parent on board-changed so the banner refetches. */
  refreshKey: number;
  onResume: (taskId: number) => void;
}

export function ContextBanner({ projectId, refreshKey, onResume }: ContextBannerProps) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftRequest, setDraftRequest] = useState("");
  const [draftPlan, setDraftPlan] = useState("");
  const [copied, setCopied] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const dragStartY = useRef<number>(0);
  const dragStartH = useRef<number>(0);

  function onDragStart(e: React.MouseEvent) {
    dragStartY.current = e.clientY;
    dragStartH.current = height ?? (e.currentTarget.closest("[data-banner]") as HTMLElement)?.offsetHeight ?? 120;
    function onMove(ev: MouseEvent) {
      const delta = ev.clientY - dragStartY.current;
      setHeight(Math.max(60, dragStartH.current + delta));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function load() {
    try {
      setBriefing(await getBriefing(projectId));
    } catch {
      setBriefing(null);
    }
  }

  useEffect(() => {
    load();
  }, [projectId, refreshKey]);

  if (!briefing) return null;
  const p = briefing.project;
  const hasContext = p.original_request || p.plan_summary || p.last_session_id;

  function startEdit() {
    setDraftRequest(p.original_request);
    setDraftPlan(p.plan_summary);
    setEditing(true);
  }

  async function saveEdit() {
    await updateProjectContext(projectId, draftRequest, draftPlan);
    setEditing(false);
    await load();
  }

  async function copySession() {
    if (!p.last_session_id) return;
    await navigator.clipboard.writeText(p.last_session_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // A dragged height is a request, not a guarantee: `max-h-[80%]` below still
  // caps it, so the board can never be pushed out of view.
  const bannerStyle = !collapsed && height !== null ? { height } : undefined;

  return (
    <div
      data-banner
      // Long context used to grow this banner without limit. Being `shrink-0`,
      // it then squeezed the sibling board to zero height and the tasks
      // disappeared entirely. Capping at 80% of the panel and scrolling the
      // overflow keeps at least a fifth of the height for the board.
      className="relative shrink-0 max-h-[80%] overflow-y-auto border-b border-[#1c2230] bg-[#0d1018] px-4 py-2.5 text-xs"
      style={bannerStyle}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-slate-500 hover:text-slate-300"
          title={collapsed ? "Expand context" : "Collapse context"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <span className="font-semibold uppercase tracking-wider text-slate-500">Context</span>
        {p.tp_user_story_id !== null && (
          <TpChip
            entityId={p.tp_user_story_id}
            label="US"
            title={`Open user story #${p.tp_user_story_id}${
              p.tp_user_story_name ? ` — ${p.tp_user_story_name}` : ""
            } in TargetProcess`}
          />
        )}
        {briefing.resume_task && (
          <button
            onClick={() => onResume(briefing.resume_task!.id)}
            className="ml-auto rounded-full bg-violet-900/60 px-2.5 py-0.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-800/70"
            title="Open the task the next AI should resume on"
          >
            ▶ Resume at #{briefing.resume_task.id} — {truncate(briefing.resume_task.title, 40)}
          </button>
        )}
        {!editing && (
          <button
            onClick={startEdit}
            className={`${briefing.resume_task ? "" : "ml-auto"} rounded px-2 py-0.5 text-[11px] text-slate-600 hover:text-slate-300`}
          >
            edit
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="mt-2 grid grid-cols-2 gap-4">
          {/* left: north-star context */}
          <div>
            {editing ? (
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-slate-600">Original request</label>
                <textarea
                  value={draftRequest}
                  onChange={(e) => setDraftRequest(e.target.value)}
                  rows={2}
                  className="resize-none rounded border border-[#2a3040] bg-[#0b0e14] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
                />
                <label className="text-[10px] text-slate-600">Approved plan</label>
                <textarea
                  value={draftPlan}
                  onChange={(e) => setDraftPlan(e.target.value)}
                  rows={3}
                  className="resize-none rounded border border-[#2a3040] bg-[#0b0e14] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-600"
                />
                <div className="flex gap-1">
                  <button onClick={saveEdit} className="rounded bg-sky-700 px-2 py-0.5 text-[11px] text-white">
                    Save
                  </button>
                  <button onClick={() => setEditing(false)} className="rounded px-2 py-0.5 text-[11px] text-slate-500">
                    Cancel
                  </button>
                </div>
              </div>
            ) : hasContext ? (
              <>
                {p.original_request && (
                  <div className="mb-2">
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                      Original request
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-300">
                      {p.original_request}
                    </div>
                  </div>
                )}
                {p.plan_summary && (
                  <div className="mb-2">
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                      Approved plan
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed text-slate-400">
                      {p.plan_summary}
                    </div>
                  </div>
                )}
                {p.last_session_id && (
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                      Session ID
                    </div>
                    <div className="flex items-center gap-1.5">
                      <code className="rounded bg-[#11151f] px-1.5 py-0.5 text-[11px] text-slate-300">
                        {p.last_session_id}
                      </code>
                      <button
                        onClick={copySession}
                        className="text-slate-600 hover:text-slate-300"
                        title="Copy session id — resume with: claude --resume <id>"
                      >
                        {copied ? "✓" : "⧉"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button onClick={startEdit} className="italic text-slate-700 hover:text-slate-400">
                No context yet — click to add the original request and plan…
              </button>
            )}
          </div>

          {/* right: handoff state */}
          <div>
            <div className="mb-0.5 text-[10px] uppercase tracking-wide text-slate-600">
              Handoff — where the last AI stopped
            </div>
            <div className="flex flex-col gap-1 text-slate-400">
              {p.last_actor ? (
                <div>
                  <span className="text-slate-600">last actor:</span> {p.last_actor}
                </div>
              ) : (
                <div className="italic text-slate-700">No handoff yet — an AI will record where it stopped here.</div>
              )}
              {p.current_task_id && (
                <div>
                  <span className="text-slate-600">stopped at:</span>{" "}
                  <button
                    onClick={() => onResume(p.current_task_id!)}
                    className="text-violet-300 hover:underline"
                  >
                    #{p.current_task_id}
                  </button>
                </div>
              )}
              {p.handoff_note && (
                <div className="whitespace-pre-wrap">
                  <span className="text-slate-600">note:</span> {p.handoff_note}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-slate-600">session:</span>
                {p.last_session_id ? (
                  <>
                    <code className="rounded bg-[#11151f] px-1.5 py-0.5 text-[11px] text-slate-300">
                      {p.last_session_id}
                    </code>
                    <button
                      onClick={copySession}
                      className="text-slate-600 hover:text-slate-300"
                      title="Copy — resume with: claude --resume <id>"
                    >
                      {copied ? "✓" : "⧉"}
                    </button>
                  </>
                ) : (
                  <span className="italic text-slate-700">not recorded yet</span>
                )}
              </div>
              {p.handoff_updated_at && (
                <div className="text-[10px] text-slate-700">
                  updated {p.handoff_updated_at.slice(0, 16).replace("T", " ")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* drag-to-resize handle */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          className="absolute bottom-0 left-0 right-0 h-1 cursor-row-resize hover:bg-sky-700/40"
          title="Drag to resize"
        />
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
