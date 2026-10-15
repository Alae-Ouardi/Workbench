// CodeMirror look built on the app's theme tokens, so the editor follows
// dark and light mode without its own palette.

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12.5px",
    color: "var(--ink-200)",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.6",
  },
  ".cm-content": { caretColor: "var(--acc-400)", padding: "10px 0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--acc-400)", borderLeftWidth: "2px" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--ink-600)",
    border: "none",
    borderRight: "1px solid var(--line-soft)",
  },
  ".cm-activeLine": { backgroundColor: "var(--line-soft)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--ink-300)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "rgb(34 211 238 / 0.22) !important",
  },
  ".cm-matchingBracket": { backgroundColor: "rgb(167 139 250 / 0.25)", outline: "none" },
  ".cm-searchMatch": { backgroundColor: "rgb(251 191 36 / 0.25)" },
  ".cm-searchMatch-selected": { backgroundColor: "rgb(251 191 36 / 0.55)" },
  ".cm-tooltip": {
    backgroundColor: "var(--panel-solid)",
    border: "1px solid var(--line-strong)",
    borderRadius: "10px",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--line)",
    color: "var(--ink-50)",
  },
  ".cm-panels": { backgroundColor: "var(--panel-solid)", color: "var(--ink-200)", borderColor: "var(--line)" },
  ".cm-panel input, .cm-panel button": { fontSize: "12px" },
  // Find & replace panel
  ".cm-panel.cm-search": { padding: "6px 8px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" },
  ".cm-panel.cm-search br": { flexBasis: "100%", height: 0 },
  ".cm-panel.cm-search input.cm-textfield": {
    background: "var(--bg)",
    color: "var(--ink-50)",
    border: "1px solid var(--line-strong)",
    borderRadius: "6px",
    padding: "3px 7px",
    minWidth: "180px",
    outline: "none",
  },
  ".cm-panel.cm-search input.cm-textfield:focus": { borderColor: "var(--acc-400)" },
  ".cm-panel.cm-search .cm-button": {
    background: "var(--line-soft)",
    backgroundImage: "none",
    color: "var(--ink-200)",
    border: "1px solid var(--line)",
    borderRadius: "6px",
    padding: "3px 8px",
    cursor: "pointer",
  },
  ".cm-panel.cm-search .cm-button:hover": { background: "var(--line)", color: "var(--ink-50)" },
  ".cm-panel.cm-search label": { color: "var(--ink-400)", fontSize: "11.5px", display: "inline-flex", alignItems: "center", gap: "3px" },
  ".cm-panel.cm-search button[name=close]": { color: "var(--ink-400)", fontSize: "16px", right: "8px", top: "4px" },
  // Diff view
  ".cm-changedLine": { backgroundColor: "rgb(251 191 36 / 0.07)" },
  ".cm-insertedLine, .cm-changedText": { backgroundColor: "rgb(52 211 153 / 0.14)" },
  ".cm-deletedChunk, .cm-deletedText": { backgroundColor: "rgb(251 113 133 / 0.16)" },
  ".cm-mergeView .cm-gutters": { borderRight: "1px solid var(--line-soft)" },
  ".cm-collapsedLines": {
    background: "var(--line-soft)",
    color: "var(--ink-400)",
    borderTop: "1px solid var(--line)",
    borderBottom: "1px solid var(--line)",
  },
  ".cm-collapsedLines:before, .cm-collapsedLines:after": { display: "none" },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "#c4b5fd", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#6ee7b7" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#fbbf24" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--ink-500)", fontStyle: "italic" },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: "#67e8f9" },
  { tag: [t.typeName, t.className], color: "#f9a8d4" },
  { tag: [t.function(t.variableName), t.standard(t.name)], color: "#93c5fd" },
  { tag: [t.punctuation, t.separator, t.bracket], color: "var(--ink-400)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--ink-400)" },
]);

export const editorHighlighting = syntaxHighlighting(highlight);
