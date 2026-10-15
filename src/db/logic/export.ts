// Exports of a result set: CSV, JSON, and INSERT statements.

import type { Cell, ColumnMeta } from "../types";

function csvField(value: Cell): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: ColumnMeta[], rows: Cell[][]): string {
  return [columns.map((c) => csvField(c.name)), ...rows.map((r) => r.map(csvField))].map((r) => r.join(",")).join("\n") + "\n";
}

export function toJson(columns: ColumnMeta[], rows: Cell[][]): string {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(columns.map((c, i) => [c.name, r[i]]))),
    null,
    2,
  );
}

export function sqlIdent(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

export function sqlLiteral(value: Cell, kind: ColumnMeta["kind"]): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (kind === "binary" && /^0x[0-9A-F]+$/.test(value)) return value;
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/** One INSERT per row, for the table the columns came from. */
export function toInserts(table: string, columns: ColumnMeta[], rows: Cell[][]): string {
  const cols = columns.map((c) => sqlIdent(c.name)).join(", ");
  return rows.map((r) => `INSERT INTO ${sqlIdent(table)} (${cols}) VALUES (${r.map((v, i) => sqlLiteral(v, columns[i].kind)).join(", ")});`).join("\n");
}

/** Statements that only read (mirror of the backend check, to decide on confirmation). */
export function isReadOnlySql(sql: string): boolean {
  // MySQL executes /*! … */ comments, so they can never count as inert.
  if (sql.includes("/*!")) return false;
  const statements = sql
    .split(";")
    .map((s) =>
      s
        .split("\n")
        .filter((l) => !/^\s*(--|#)/.test(l))
        .join("\n")
        .replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  if (!statements.length) return false;
  return statements.every((s) => {
    const lower = s.toLowerCase();
    const first = lower.split(/\s+/)[0];
    if (!["select", "show", "describe", "desc", "explain", "with", "use", "help"].includes(first)) return false;
    if (/\binto (outfile|dumpfile)\b/.test(lower)) return false;
    return !(first === "with" && /\b(update|delete|insert)\s/.test(lower));
  });
}
