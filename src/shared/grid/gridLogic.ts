// Pure helpers behind the data grid: display text, clipboard text, widths.

export type CellValue = string | number | boolean | null | undefined;

export const MIN_COL_WIDTH = 56;
export const MAX_COL_WIDTH = 640;

/** Text shown in a cell; null-ish values are rendered by the grid as NULL. */
export function displayText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value);
  // Keep rows one line tall; the full value is in the cell inspector.
  return text.length > 300 ? `${text.slice(0, 300)}…` : text.replace(/\s*\n\s*/g, " ⏎ ");
}

/** Tab-separated text for copying a block of cells into a spreadsheet. */
export function toTsv(rows: CellValue[][]): string {
  const clean = (v: CellValue) => (v === null || v === undefined ? "NULL" : String(v).replace(/[\t\n\r]+/g, " "));
  return rows.map((r) => r.map(clean).join("\t")).join("\n");
}

export function clampWidth(width: number): number {
  return Math.round(Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, width)));
}

/** A first guess at a column's width from its title and some sample values. */
export function guessWidth(title: string, samples: CellValue[]): number {
  const longest = samples.reduce<number>((max, v) => Math.max(max, displayText(v).length), title.length + 2);
  return clampWidth(longest * 7.4 + 24);
}

/** Move a cell cursor inside a rows × cols grid. */
export function moveCursor(
  cursor: { row: number; col: number },
  key: string,
  rows: number,
  cols: number,
): { row: number; col: number } {
  const clampRow = (r: number) => Math.min(Math.max(r, 0), Math.max(rows - 1, 0));
  const clampCol = (c: number) => Math.min(Math.max(c, 0), Math.max(cols - 1, 0));
  switch (key) {
    case "ArrowUp":
      return { ...cursor, row: clampRow(cursor.row - 1) };
    case "ArrowDown":
      return { ...cursor, row: clampRow(cursor.row + 1) };
    case "ArrowLeft":
      return { ...cursor, col: clampCol(cursor.col - 1) };
    case "ArrowRight":
    case "Tab":
      return { ...cursor, col: clampCol(cursor.col + 1) };
    case "Home":
      return { ...cursor, col: 0 };
    case "End":
      return { ...cursor, col: clampCol(cols - 1) };
    case "PageUp":
      return { ...cursor, row: clampRow(cursor.row - 20) };
    case "PageDown":
      return { ...cursor, row: clampRow(cursor.row + 20) };
    default:
      return cursor;
  }
}
