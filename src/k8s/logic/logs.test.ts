import { describe, expect, it } from "vitest";
import { appendCapped, compileFilter, levelOf, splitPrefix } from "./logs";

describe("log helpers", () => {
  it("detects levels in plain and JSON logs", () => {
    expect(levelOf("2026-10-12 ERROR something broke")).toBe("error");
    expect(levelOf('{"level":"warning","msg":"slow"}')).toBe("warn");
    expect(levelOf("ts=1 level=debug msg=x")).toBe("debug");
    expect(levelOf("GET /health 200")).toBeNull();
  });

  it("filters by text, regex and level", () => {
    const text = compileFilter({ text: "Order", regex: false, minLevel: "all" })!;
    expect(text("created order 12")).toBe(true);
    const re = compileFilter({ text: "order \\d{2}$", regex: true, minLevel: "all" })!;
    expect(re("created order 12")).toBe(true);
    expect(re("created order 123")).toBe(false);
    expect(compileFilter({ text: "(", regex: true, minLevel: "all" })).toBeNull();
    const errors = compileFilter({ text: "", regex: false, minLevel: "warn" })!;
    expect(errors("WARN disk")).toBe(true);
    expect(errors("INFO ok")).toBe(false);
  });

  it("caps the buffer, keeping the newest lines", () => {
    expect(appendCapped(["a", "b"], ["c", "d"], 3)).toEqual(["b", "c", "d"]);
  });

  it("splits container prefixes", () => {
    expect(splitPrefix("[pod/api-1/app] hello")).toEqual({ prefix: "app", text: "hello" });
    expect(splitPrefix("hello")).toEqual({ prefix: null, text: "hello" });
  });
});
