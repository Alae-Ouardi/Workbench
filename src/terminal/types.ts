// The Terminal workspace's saved model: folders, each with a tree of split
// panes. Shells themselves are never saved — they restart in each pane's cwd.

export type SplitDir = "row" | "col";
export type Direction = "left" | "right" | "up" | "down";

/** What a pane shows: a shell, or a web page (url "" = the start picker). */
export type PaneView = "terminal" | "browser";

export type PaneNode =
  | { kind: "pane"; id: string; cwd: string; view?: PaneView; url?: string; title?: string }
  | { kind: "split"; id: string; dir: SplitDir; ratio: number; a: PaneNode; b: PaneNode };

/** One tab of a folder: a terminal or browser, splittable. */
export interface TermTab {
  id: string;
  /** Set when the user renamed the tab; otherwise derived from its content. */
  title?: string;
  layout: PaneNode;
  /** The pane keystrokes go to. */
  focused: string;
}

export interface TermFolder {
  id: string;
  /** Absolute path the folder's terminals start in. */
  path: string;
  name: string;
  tabs: TermTab[];
  activeTab: string;
}
