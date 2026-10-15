import { describe, expect, it } from "vitest";
import type { ColumnMeta } from "../types";
import { addInsert, editCount, NO_EDITS, setCell, setInsertCell, toChanges, toggleDelete } from "./edits";
import { isReadOnlySql, toCsv, toInserts, toJson } from "./export";

const cols: ColumnMeta[] = [
  { name: "id", kind: "number", table: "users" },
  { name: "name", kind: "text", table: "users" },
];
const rows = [
  [1, "Ann"],
  [2, "O'Brien"],
];

describe("grid edits", () => {
  it("tracks edits and reverts when the original value comes back", () => {
    let e = setCell(NO_EDITS, 0, "name", "Anna", "Ann");
    expect(editCount(e)).toBe(1);
    e = setCell(e, 0, "name", "Ann", "Ann");
    expect(editCount(e)).toBe(0);
  });

  it("builds updates, inserts and deletes keyed by primary key", () => {
    let e = setCell(NO_EDITS, 1, "name", null, "O'Brien");
    e = setInsertCell(addInsert(e), 0, "name", "Bob");
    e = toggleDelete(e, 0);
    expect(toChanges(e, rows, cols, ["id"])).toEqual([
      { kind: "update", key: { id: "2" }, values: { name: null } },
      { kind: "insert", values: { name: "Bob" } },
      { kind: "delete", key: { id: "1" } },
    ]);
  });

  it("deleting a row drops its pending edits", () => {
    const e = toggleDelete(setCell(NO_EDITS, 0, "name", "x", "Ann"), 0);
    expect(e.updates).toEqual({});
    expect(toggleDelete(e, 0).deletes).toEqual([]);
  });
});

describe("exports", () => {
  it("writes CSV with quoting and empty NULLs", () => {
    expect(toCsv(cols, [[1, 'say "hi", ok'], [2, null]])).toBe('id,name\n1,"say ""hi"", ok"\n2,\n');
  });

  it("writes JSON objects", () => {
    expect(JSON.parse(toJson(cols, rows))).toEqual([{ id: 1, name: "Ann" }, { id: 2, name: "O'Brien" }]);
  });

  it("writes INSERT statements with escaped literals", () => {
    expect(toInserts("users", cols, [rows[1], [3, null]])).toBe(
      "INSERT INTO `users` (`id`, `name`) VALUES (2, 'O''Brien');\nINSERT INTO `users` (`id`, `name`) VALUES (3, NULL);",
    );
  });

  it("knows which SQL only reads", () => {
    expect(isReadOnlySql("select 1")).toBe(true);
    expect(isReadOnlySql("-- c\nSHOW TABLES;")).toBe(true);
    expect(isReadOnlySql("select 1; update t set a=1")).toBe(false);
    expect(isReadOnlySql("WITH x AS (select 1) DELETE FROM t")).toBe(false);
    expect(isReadOnlySql("  ")).toBe(false);
    expect(isReadOnlySql("SELECT 1; /*!50000 DELETE FROM t */")).toBe(false);
    expect(isReadOnlySql("select * from t into\n outfile '/x'")).toBe(false);
    expect(isReadOnlySql("WITH x AS (select 1) DELETE\nFROM t")).toBe(false);
  });
});
