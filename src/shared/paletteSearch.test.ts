import { describe, expect, it } from "vitest";
import { rankEntries } from "./paletteSearch";

const e = (label: string, detail = "") => ({ label, detail });

describe("palette ranking", () => {
  it("needs every word and ranks label prefixes first", () => {
    const entries = [e("api-7f9c", "review-acme"), e("worker", "review-acme api"), e("api-gateway", "latest-acme")];
    expect(rankEntries(entries, "api review").map((x) => x.label)).toEqual(["api-7f9c", "worker"]);
    expect(rankEntries(entries, "api").map((x) => x.label)).toEqual(["api-7f9c", "api-gateway", "worker"]);
  });

  it("returns everything for an empty query", () => {
    expect(rankEntries([e("a"), e("b")], "  ")).toHaveLength(2);
  });
});
