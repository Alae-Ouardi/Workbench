// View and edit an object's YAML: edit → review the diff → validate on the
// server (dry run) → confirm → apply. A stale version is refused by the
// server, so someone else's newer change is never overwritten.

import { useEffect, useRef, useState } from "react";
import { useConfirm } from "../../shared/confirm/ConfirmProvider";
import { CodeEditor, type CodeEditorHandle } from "../../shared/editor/CodeEditor";
import { DiffEditor } from "../../shared/editor/DiffEditor";
import { errorText, k8s } from "../api";
import type { EnvRef, K8sObject, ResourceKind } from "../types";

type Mode = "view" | "edit" | "diff";

export function YamlTab({ env, kind, obj }: { env: EnvRef; kind: ResourceKind; obj: K8sObject }) {
  const confirm = useConfirm();
  const [original, setOriginal] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState<"validate" | "apply" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const editor = useRef<CodeEditorHandle>(null);
  const target = { ...env, kind, name: obj.metadata.name };

  useEffect(() => {
    let live = true;
    setOriginal(null);
    setMessage(null);
    setMode("view");
    k8s
      .yaml(target)
      .then((y) => {
        if (!live) return;
        setOriginal(y);
        setDraft(y);
      })
      .catch((e) => live && setMessage({ tone: "bad", text: errorText(e) }));
    return () => {
      live = false;
    };
  }, [env.context, env.namespace, kind, obj.metadata.name, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = original !== null && draft !== original;

  async function validate(): Promise<boolean> {
    setBusy("validate");
    setMessage(null);
    try {
      await k8s.replaceYaml(env, draft, true);
      setMessage({ tone: "ok", text: "The cluster accepted this change (dry run). Nothing was saved yet." });
      return true;
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!(await validate())) return;
    const ok = await confirm({
      title: `Apply YAML changes to ${kind.replace(/s$/, "")} ${obj.metadata.name}`,
      target: [
        { label: "cluster", value: env.context },
        { label: "namespace", value: env.namespace },
        { label: kind, value: obj.metadata.name },
      ],
      envNames: [env.namespace, env.context],
      detail: <p className="text-[12px] text-slate-400">The server validated this change. It replaces the live object.</p>,
      confirmLabel: "Apply",
    });
    if (!ok) return;
    setBusy("apply");
    try {
      await k8s.replaceYaml(env, draft, false);
      setMessage({ tone: "ok", text: "Applied." });
      setTick((t) => t + 1);
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  /** Find works read-only; replacing switches to editing first. */
  function openSearch(replace: boolean) {
    const needsEditor = mode === "diff" || (replace && mode === "view");
    if (needsEditor) setMode("edit");
    // After a mode switch the editor re-renders; open on the next frame.
    requestAnimationFrame(() => editor.current?.openSearch(replace));
  }

  if (original === null && !message) return <p className="p-4 text-xs text-slate-500">Loading YAML…</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--line-soft)] px-3 py-2">
        {mode === "view" ? (
          <button className="btn py-1 text-xs" onClick={() => setMode("edit")} disabled={original === null}>
            Edit
          </button>
        ) : (
          <>
            <div className="flex rounded-lg border border-[var(--line)] p-0.5 text-[11px]">
              {(["edit", "diff"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-2 py-0.5 ${mode === m ? "bg-[var(--line)] text-slate-100" : "text-slate-400"}`}
                >
                  {m === "edit" ? "Editor" : "Changes"}
                </button>
              ))}
            </div>
            <button className="btn py-1 text-xs" onClick={() => void validate()} disabled={!changed || busy !== null}>
              {busy === "validate" ? "Validating…" : "Validate"}
            </button>
            <button className="btn btn-primary py-1 text-xs" onClick={() => void apply()} disabled={!changed || busy !== null}>
              {busy === "apply" ? "Applying…" : "Apply…"}
            </button>
            <button
              className="btn py-1 text-xs"
              onClick={() => {
                setDraft(original ?? "");
                setMode("view");
                setMessage(null);
              }}
            >
              Discard
            </button>
          </>
        )}
        <span className="mx-1 h-4 w-px bg-[var(--line)]" />
        <button className="btn py-1 text-xs" onClick={() => openSearch(false)} disabled={original === null} title="Find (⌘F)">
          Find
        </button>
        <button className="btn py-1 text-xs" onClick={() => openSearch(true)} disabled={original === null} title="Find and replace (⌥⌘F)">
          Replace
        </button>
        <span className="ml-auto text-[11px] text-slate-500">{changed ? "Unsaved changes" : mode === "view" ? "Read-only" : "No changes"}</span>
        <button className="btn py-1 text-xs" onClick={() => setTick((t) => t + 1)} title="Reload from the cluster">
          Reload
        </button>
      </div>
      {message && (
        <p className={`mx-3 mt-2 rounded-lg px-3 py-2 text-[12px] whitespace-pre-wrap ${message.tone === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
          {message.text}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {mode === "diff" && original !== null ? (
          <DiffEditor original={original} modified={draft} language="yaml" onChange={setDraft} />
        ) : (
          <CodeEditor ref={editor} value={draft} language="yaml" readOnly={mode === "view"} onChange={setDraft} onRun={() => void apply()} />
        )}
      </div>
    </div>
  );
}
