import { useEffect, useState } from "react";
import { tpBackfillProject, tpGetSettings, tpLinkProject, tpUnlinkProject } from "../../api";
import type { ProjectSummary, TpUserStory } from "../../types";
import { TpChip } from "./TpChip";
import { UserStoryPicker } from "./UserStoryPicker";

interface ProjectLinkPanelProps {
  project: ProjectSummary;
  onChanged: () => void;
  onOpenSettings?: () => void;
}

/**
 * Link or unlink one project's TargetProcess user story.
 *
 * Linking a project that already has tasks offers to mirror them, since the
 * common case is linking mid-flight after an agent has already planned.
 */
export function ProjectLinkPanel({
  project,
  onChanged,
  onOpenSettings,
}: ProjectLinkPanelProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<TpUserStory | null>(null);
  const [notConfigured, setNotConfigured] = useState<string | null>(null);

  const taskCount =
    project.open + project.waiting + project.in_progress + project.review + project.done;

  // Checked when the panel mounts, so it only runs once the user opens it.
  useEffect(() => {
    let alive = true;
    void tpGetSettings().then((s) => {
      if (!alive) return;
      if (!s.base_url_normalized) setNotConfigured("Add your TargetProcess URL in Settings");
      else if (!s.token_set) setNotConfigured("Add your access token in Settings");
      else setNotConfigured(null);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setNote(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (project.tp_user_story_id) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <TpChip entityId={project.tp_user_story_id} label="US" size="md" />
          <span className="truncate text-xs text-slate-400">
            {project.tp_user_story_name || "linked user story"}
          </span>
        </div>
        <p className="text-[10px] leading-relaxed text-slate-600">
          New tasks here are mirrored under this story. Completing one moves it to your done
          state and logs its estimate as time.
        </p>
        {note && <p className="text-[10px] text-amber-500">{note}</p>}
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                const queued = await tpBackfillProject(project.id);
                setNote(
                  queued > 0
                    ? `Queued ${queued} operation(s).`
                    : "Everything is already mirrored.",
                );
              })
            }
            title="Queue any tasks that have not reached TargetProcess yet"
            className="rounded border border-[#2a3040] px-2 py-1 text-[10px] text-slate-400 hover:text-sky-400 disabled:opacity-40"
          >
            Push existing tasks
          </button>
          <button
            disabled={busy}
            onClick={() => act(() => tpUnlinkProject(project.id))}
            title="Stop syncing. TargetProcess entities are left alone."
            className="rounded border border-[#2a3040] px-2 py-1 text-[10px] text-slate-400 hover:text-red-400 disabled:opacity-40"
          >
            Unlink
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <UserStoryPicker
        value={picked}
        onChange={setPicked}
        disabledReason={notConfigured ?? undefined}
      />
      {notConfigured && onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="text-[10px] text-sky-500 hover:text-sky-400"
        >
          Open Settings →
        </button>
      )}
      {note && <p className="text-[10px] text-amber-500">{note}</p>}
      {picked && (
        <button
          disabled={busy}
          onClick={() =>
            act(async () => {
              await tpLinkProject(project.id, String(picked.id));
              if (taskCount > 0) {
                const queued = await tpBackfillProject(project.id);
                setNote(`Linked, and queued ${queued} operation(s) for existing tasks.`);
              }
              setPicked(null);
            })
          }
          className="w-full rounded bg-sky-700 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-600 disabled:opacity-40"
        >
          {busy
            ? "Linking…"
            : taskCount > 0
              ? `Link and mirror ${taskCount} existing task${taskCount === 1 ? "" : "s"}`
              : "Link user story"}
        </button>
      )}
    </div>
  );
}
