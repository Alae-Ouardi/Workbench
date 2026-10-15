// Pending grid edits before they are confirmed: edited cells, new rows and
// rows marked for deletion, turned into row changes for the backend.

import type { Cell, ColumnMeta, RowChange } from "../types";

export interface Edits {
  /** Row index → column name → new value (null = SQL NULL). */
  updates: Record<number, Record<string, string | null>>;
  /** New rows, column name → value (absent = default). */
  inserts: Record<string, string | null>[];
  /** Row indexes to delete. */
  deletes: number[];
}

export const NO_EDITS: Edits = { updates: {}, inserts: [], deletes: [] };

export function editCount(e: Edits): number {
  return Object.keys(e.updates).length + e.inserts.length + e.deletes.length;
}

export function cellText(value: Cell): string | null {
  return value === null ? null : String(value);
}

export function setCell(e: Edits, row: number, column: string, value: string | null, original: Cell): Edits {
  const current = { ...(e.updates[row] ?? {}) };
  if (value === cellText(original)) delete current[column];
  else current[column] = value;
  const updates = { ...e.updates };
  if (Object.keys(current).length) updates[row] = current;
  else delete updates[row];
  return { ...e, updates };
}

export function toggleDelete(e: Edits, row: number): Edits {
  const deletes = e.deletes.includes(row) ? e.deletes.filter((r) => r !== row) : [...e.deletes, row];
  const { [row]: _dropped, ...updates } = e.updates;
  return { ...e, deletes, updates };
}

export function addInsert(e: Edits): Edits {
  return { ...e, inserts: [...e.inserts, {}] };
}

export function setInsertCell(e: Edits, index: number, column: string, value: string | null): Edits {
  return { ...e, inserts: e.inserts.map((row, i) => (i === index ? { ...row, [column]: value } : row)) };
}

export function removeInsert(e: Edits, index: number): Edits {
  return { ...e, inserts: e.inserts.filter((_, i) => i !== index) };
}

/** Row changes in a stable order: updates, inserts, deletes. */
export function toChanges(e: Edits, rows: Cell[][], columns: ColumnMeta[], primaryKey: string[]): RowChange[] {
  const index = new Map(columns.map((c, i) => [c.name, i]));
  const keyOf = (row: Cell[]) => Object.fromEntries(primaryKey.map((k) => [k, cellText(row[index.get(k)!])]));
  const changes: RowChange[] = [];
  for (const [row, values] of Object.entries(e.updates).sort(([a], [b]) => Number(a) - Number(b))) {
    changes.push({ kind: "update", key: keyOf(rows[Number(row)]), values });
  }
  for (const values of e.inserts) changes.push({ kind: "insert", values });
  for (const row of [...e.deletes].sort((a, b) => a - b)) changes.push({ kind: "delete", key: keyOf(rows[row]) });
  return changes;
}
