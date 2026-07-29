import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { createProject, tpLinkProject } from "../api";
import type { Project, TpUserStory } from "../types";
import { UserStoryPicker } from "./tp/UserStoryPicker";

interface NewProjectModalProps {
  onCreated: (project: Project) => void;
  onClose: () => void;
}

export function NewProjectModal({ onCreated, onClose }: NewProjectModalProps) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [story, setStory] = useState<TpUserStory | null>(null);

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) {
      setPath(selected);
      if (!name) {
        const basename = selected.split("/").filter(Boolean).pop() ?? "";
        setName(basename);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) { setError("Choose a project folder."); return; }
    if (!name.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const project = await createProject(path.trim(), name.trim(), description.trim());
      if (story) {
        // Linking is secondary: keep the project even if TargetProcess refuses,
        // and say so rather than looking like the whole thing failed.
        try {
          await tpLinkProject(project.id, String(story.id));
        } catch (linkErr: unknown) {
          setError(`Project created, but linking the user story failed: ${linkErr}`);
          setSaving(false);
          return;
        }
      }
      onCreated(project);
    } catch (err: unknown) {
      setError(String(err));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={handleSubmit}
        className="w-[480px] rounded-xl border border-[#2a3040] bg-[#11151f] p-5 shadow-2xl"
      >
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">
          New project
        </h2>

        <label className="mb-1 block text-xs text-slate-500">Folder</label>
        <div className="mb-3 flex gap-2">
          <input
            readOnly
            value={path}
            placeholder="No folder selected"
            className="flex-1 rounded-md border border-[#2a3040] bg-[#0b0e14] px-3 py-2 text-sm text-slate-400 outline-none"
          />
          <button
            type="button"
            onClick={pickFolder}
            className="shrink-0 rounded-md border border-[#2a3040] bg-[#1c2230] px-3 py-2 text-xs text-slate-300 hover:bg-[#252e42]"
          >
            Choose…
          </button>
        </div>

        <label className="mb-1 block text-xs text-slate-500">Title</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-3 w-full rounded-md border border-[#2a3040] bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-sky-600"
          placeholder="My project"
        />

        <label className="mb-1 block text-xs text-slate-500">
          What do you want built?{" "}
          <span className="text-slate-700">(the AI reads this as its brief)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="mb-4 w-full resize-none rounded-md border border-[#2a3040] bg-[#0b0e14] px-3 py-2 text-sm outline-none focus:border-sky-600"
          placeholder="Describe what you want to build so AI tools can plan from it…"
        />

        <label className="mb-1 block text-xs text-slate-500">
          TargetProcess user story <span className="text-slate-700">(optional)</span>
        </label>
        <div className="mb-1">
          <UserStoryPicker value={story} onChange={setStory} />
        </div>
        <p className="mb-4 text-[10px] leading-relaxed text-slate-600">
          Link one and this project's tasks are mirrored under it, with their estimates logged
          as time when they're done.
        </p>

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-sky-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </div>
  );
}
