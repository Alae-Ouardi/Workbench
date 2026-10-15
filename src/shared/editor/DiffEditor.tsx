// Side-by-side diff: the original on the left (read-only), the edited copy on
// the right. Used to review a YAML change before it is applied.

import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { baseExtensions, languageExtension, type EditorLanguage } from "./CodeEditor";

export function DiffEditor({
  original,
  modified,
  language,
  onChange,
}: {
  original: string;
  /** Starting text for the edited side; later edits arrive via `onChange`. */
  modified: string;
  language: EditorLanguage;
  onChange?: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Seed the edited side once per original; typing must not rebuild the view.
  const seed = useRef(modified);

  useEffect(() => {
    const shared = [...baseExtensions(), languageExtension(language)];
    const merge = new MergeView({
      parent: host.current!,
      a: { doc: original, extensions: [...shared, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
      b: {
        doc: seed.current,
        extensions: [
          ...shared,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      },
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
    return () => merge.destroy();
  }, [original, language]);

  return <div ref={host} className="h-full min-h-0 overflow-auto [&_.cm-mergeView]:h-full" />;
}
