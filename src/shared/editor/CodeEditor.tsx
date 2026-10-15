// Code editor (SQL, YAML, plain text) on CodeMirror 6. The component owns the
// view; the parent passes the initial value and is told about changes.

import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { MySQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { editorHighlighting, editorTheme } from "./theme";

export type EditorLanguage = "sql" | "yaml" | "text";

export interface CodeEditorHandle {
  /** The selected text, or the whole document when nothing is selected. */
  selectionOrAll: () => string;
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  /** Open the find panel; with `replace`, put the cursor in the replace box. */
  openSearch: (replace?: boolean) => void;
}

interface Props {
  value: string;
  language: EditorLanguage;
  onChange?: (value: string) => void;
  /** ⌘↵ handler (run query, apply…). */
  onRun?: () => void;
  readOnly?: boolean;
  /** Table → columns, for SQL completion. */
  schema?: SQLNamespace;
  placeholder?: string;
  className?: string;
}

export function languageExtension(language: EditorLanguage, schema?: SQLNamespace): Extension {
  if (language === "sql") return sql({ dialect: MySQL, schema, upperCaseKeywords: true });
  if (language === "yaml") return yaml();
  return [];
}

export function baseExtensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    foldGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    // Find & replace panel above the text (⌘F; ⌥⌘F also opens it, Enter
    // goes to the next match, "replace all" in the panel).
    search({ top: true }),
    editorTheme,
    editorHighlighting,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
  ];
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { value, language, onChange, onRun, readOnly = false, schema, placeholder, className = "" },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  // Latest callbacks without rebuilding the editor.
  const handlers = useRef({ onChange, onRun, readOnly });
  handlers.current = { onChange, onRun, readOnly };

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        keymap.of([
          {
            key: "Mod-Enter",
            // Never "apply" from a read-only view.
            run: () => {
              if (handlers.current.readOnly) return false;
              handlers.current.onRun?.();
              return true;
            },
          },
        ]),
        ...baseExtensions(),
        langSlot.current.of(languageExtension(language, schema)),
        // Read-only still takes focus, so the text can be searched and copied.
        readOnlySlot.current.of(EditorState.readOnly.of(readOnly)),
        placeholder ? placeholderExt(placeholder) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged) handlers.current.onChange?.(update.state.doc.toString());
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current! });
    return () => view.current?.destroy();
    // The editor is created once; value/language changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: langSlot.current.reconfigure(languageExtension(language, schema)) });
  }, [language, schema]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnlySlot.current.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }, [readOnly]);

  // Replace the document when the parent supplies a different value (e.g. a
  // freshly loaded resource), but not on the echo of the user's own typing.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    selectionOrAll: () => {
      const v = view.current;
      if (!v) return "";
      const sel = v.state.selection.main;
      return sel.empty ? v.state.doc.toString() : v.state.sliceDoc(sel.from, sel.to);
    },
    getValue: () => view.current?.state.doc.toString() ?? "",
    setValue: (next) => {
      const v = view.current;
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: next } });
    },
    focus: () => view.current?.focus(),
    openSearch: (replace = false) => {
      const v = view.current;
      if (!v) return;
      openSearchPanel(v);
      if (replace) {
        // The panel renders synchronously; jump straight to its replace box.
        const field = v.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
        field?.focus();
        field?.select();
      }
    },
  }));

  return (
    <div
      ref={host}
      className={`h-full min-h-0 overflow-hidden ${className}`}
      // ⌥⌘F: open find with the cursor in "replace" (VS Code's binding).
      onKeyDown={(e) => {
        if (e.metaKey && e.altKey && e.code === "KeyF") {
          e.preventDefault();
          e.stopPropagation();
          const v = view.current;
          if (!v) return;
          openSearchPanel(v);
          const field = v.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]");
          field?.focus();
          field?.select();
        }
      }}
    />
  );
});
