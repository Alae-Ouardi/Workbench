// Pure operations on a folder's split layout. A layout is a binary tree:
// leaves are panes, inner nodes split their area by `ratio` into `a`
// (left/top) and `b` (right/bottom).

import type { Direction, PaneNode, PaneView, SplitDir, TermFolder, TermTab } from "../types";

export const MIN_RATIO = 0.15;
export const MAX_RATIO = 0.85;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function newPane(cwd: string, view: PaneView = "terminal"): PaneNode {
  return view === "browser" ? { kind: "pane", id: newId("p"), cwd, view, url: "" } : { kind: "pane", id: newId("p"), cwd };
}

/** Change one pane's fields (e.g. a browser pane's url). */
export function updatePane(node: PaneNode, paneId: string, patch: { url?: string; title?: string }): PaneNode {
  if (node.kind === "pane") return node.id === paneId ? { ...node, ...patch } : node;
  return { ...node, a: updatePane(node.a, paneId, patch), b: updatePane(node.b, paneId, patch) };
}

/** Every pane, left-to-right / top-to-bottom. */
export function panes(node: PaneNode): Extract<PaneNode, { kind: "pane" }>[] {
  return node.kind === "pane" ? [node] : [...panes(node.a), ...panes(node.b)];
}

export function findPane(node: PaneNode, id: string) {
  return panes(node).find((p) => p.id === id);
}

/** Split `paneId` in two; the new pane goes right (`row`) or below (`col`). */
export function splitPane(node: PaneNode, paneId: string, dir: SplitDir, added: PaneNode): PaneNode {
  if (node.kind === "pane") {
    return node.id === paneId ? { kind: "split", id: newId("s"), dir, ratio: 0.5, a: node, b: added } : node;
  }
  return { ...node, a: splitPane(node.a, paneId, dir, added), b: splitPane(node.b, paneId, dir, added) };
}

/** Remove a pane; its sibling takes the space. `null` when it was the last one. */
export function closePane(node: PaneNode, paneId: string): PaneNode | null {
  if (node.kind === "pane") return node.id === paneId ? null : node;
  const a = closePane(node.a, paneId);
  const b = closePane(node.b, paneId);
  if (!a) return b;
  if (!b) return a;
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

export function setRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.kind === "pane") return node;
  if (node.id === splitId) return { ...node, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) };
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The areas of a split's two children. */
function childAreas(node: Extract<PaneNode, { kind: "split" }>, area: Rect): [Rect, Rect] {
  const { x, y, w, h } = area;
  if (node.dir === "row") {
    return [{ x, y, w: w * node.ratio, h }, { x: x + w * node.ratio, y, w: w * (1 - node.ratio), h }];
  }
  return [{ x, y, w, h: h * node.ratio }, { x, y: y + h * node.ratio, w, h: h * (1 - node.ratio) }];
}

/** Each pane's area in a 1×1 square. */
export function rects(node: PaneNode, area: Rect = { x: 0, y: 0, w: 1, h: 1 }): Map<string, Rect> {
  if (node.kind === "pane") return new Map([[node.id, area]]);
  const [ra, rb] = childAreas(node, area);
  return new Map([...rects(node.a, ra), ...rects(node.b, rb)]);
}

/** Each split's area, for drawing and dragging its divider. */
export function splitRects(node: PaneNode, area: Rect = { x: 0, y: 0, w: 1, h: 1 }): { id: string; dir: SplitDir; ratio: number; area: Rect }[] {
  if (node.kind === "pane") return [];
  const [ra, rb] = childAreas(node, area);
  return [{ id: node.id, dir: node.dir, ratio: node.ratio, area }, ...splitRects(node.a, ra), ...splitRects(node.b, rb)];
}

const EPS = 1e-6;

/** The pane next to `paneId` in a direction (the most overlapping one), if any. */
export function neighbour(node: PaneNode, paneId: string, dir: Direction): string | null {
  const all = rects(node);
  const from = all.get(paneId);
  if (!from) return null;
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);
  let best: { id: string; score: number } | null = null;
  for (const [id, r] of all) {
    if (id === paneId) continue;
    const touches =
      dir === "left"
        ? Math.abs(r.x + r.w - from.x) < EPS
        : dir === "right"
          ? Math.abs(from.x + from.w - r.x) < EPS
          : dir === "up"
            ? Math.abs(r.y + r.h - from.y) < EPS
            : Math.abs(from.y + from.h - r.y) < EPS;
    if (!touches) continue;
    const score =
      dir === "left" || dir === "right" ? overlap(from.y, from.y + from.h, r.y, r.y + r.h) : overlap(from.x, from.x + from.w, r.x, r.x + r.w);
    if (score > EPS && (!best || score > best.score)) best = { id, score };
  }
  return best?.id ?? null;
}

function validNode(v: unknown): v is PaneNode {
  const n = v as PaneNode;
  if (!n || typeof n !== "object" || typeof n.id !== "string") return false;
  if (n.kind === "pane") {
    return (
      typeof n.cwd === "string" &&
      (n.view === undefined || n.view === "terminal" || n.view === "browser") &&
      (n.url === undefined || typeof n.url === "string")
    );
  }
  return (
    n.kind === "split" &&
    (n.dir === "row" || n.dir === "col") &&
    typeof n.ratio === "number" &&
    n.ratio >= MIN_RATIO &&
    n.ratio <= MAX_RATIO &&
    validNode(n.a) &&
    validNode(n.b)
  );
}

function restoreTab(t: unknown): TermTab | null {
  const tab = t as TermTab;
  if (!tab || typeof tab.id !== "string" || !validNode(tab.layout)) return null;
  const ids = panes(tab.layout).map((p) => p.id);
  return {
    id: tab.id,
    title: typeof tab.title === "string" && tab.title.trim() ? tab.title : undefined,
    layout: tab.layout,
    focused: ids.includes(tab.focused) ? tab.focused : ids[0],
  };
}

/**
 * Saved folders, keeping only well-formed ones (a bad entry never breaks the
 * view). Folders saved before tabs existed (one `layout`) become one tab.
 */
export function restoreFolders(raw: unknown): TermFolder[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) => {
    if (!f || typeof f.id !== "string" || typeof f.path !== "string") return [];
    const tabs: TermTab[] = Array.isArray(f.tabs)
      ? f.tabs.map(restoreTab).filter((t: TermTab | null): t is TermTab => t !== null)
      : [restoreTab({ id: `t-${f.id}`, layout: f.layout, focused: f.focused })].filter((t): t is TermTab => t !== null);
    if (!tabs.length) return [];
    const name = typeof f.name === "string" && f.name.trim() ? f.name : f.path.split("/").filter(Boolean).pop() || f.path;
    const activeTab = tabs.some((t) => t.id === f.activeTab) ? f.activeTab : tabs[0].id;
    return [{ id: f.id, path: f.path, name, tabs, activeTab }];
  });
}

/** A tab's label: its custom name, the page for a browser, else "Terminal n". */
export function tabLabel(tab: TermTab, tabs: TermTab[]): string {
  if (tab.title) return tab.title;
  const first = panes(tab.layout)[0];
  if (first?.view === "browser") {
    if (first.title) return first.title;
    if (first.url) {
      try {
        return new URL(first.url).host;
      } catch {
        return first.url;
      }
    }
    return "New browser";
  }
  const terminals = tabs.filter((t) => panes(t.layout)[0]?.view !== "browser");
  return `Terminal ${terminals.indexOf(tab) + 1}`;
}
