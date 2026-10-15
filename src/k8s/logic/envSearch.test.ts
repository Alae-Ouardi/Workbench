import { describe, expect, it } from "vitest";
import { buildEntries, clientOf, envKey, namespaceGuess, parseEnvKey, pushRecent, searchEnvs } from "./envSearch";

const index = {
  "integration.example.cloud": ["review-acme", "latest-acme", "uat-globex", "review-globex", "kube-system", "monitoring"],
  "prod.euc1.example.cloud": ["prod-acme", "prod-globex", "kube-system"],
  "prod.initech.example.cloud": ["prod-initech", "default"],
};
const entries = buildEntries(index);

describe("environment search", () => {
  it("guesses env-client namespaces from free text", () => {
    expect(namespaceGuess("review acme")).toBe("review-acme");
    expect(namespaceGuess("acme prod")).toBe("prod-acme");
    expect(namespaceGuess("review-acme")).toBe("review-acme");
    expect(namespaceGuess("acme")).toBeNull();
  });

  it("puts the exact env first", () => {
    const hits = searchEnvs(entries, "review acme");
    expect(hits[0]).toMatchObject({ namespace: "review-acme", context: "integration.example.cloud" });
  });

  it("finds every env of a client across clusters", () => {
    const names = searchEnvs(entries, "acme").map((e) => e.namespace);
    expect(names).toEqual(expect.arrayContaining(["review-acme", "latest-acme", "prod-acme"]));
    expect(names).not.toContain("prod-globex");
  });

  it("matches on cluster names too and ranks plumbing last", () => {
    const hits = searchEnvs(entries, "euc1");
    expect(hits.map((e) => e.namespace)).toEqual(["prod-acme", "prod-globex", "kube-system"]);
  });

  it("hides system namespaces from the empty query", () => {
    expect(searchEnvs(entries, "").some((e) => e.namespace === "kube-system")).toBe(false);
  });

  it("tags tiers and shared clusters", () => {
    const prod = entries.find((e) => e.namespace === "prod-acme")!;
    expect(prod.tier).toBe("prod");
    expect(entries.find((e) => e.namespace === "review-acme")!.sharedCluster).toBe(true);
    expect(entries.find((e) => e.namespace === "prod-initech")!.sharedCluster).toBe(false);
  });

  it("round-trips env keys, including contexts with slashes", () => {
    const env = { context: "arn:aws:eks:eu:1:cluster/x", namespace: "review-acme" };
    expect(parseEnvKey(envKey(env))).toEqual(env);
  });

  it("keeps recents unique and capped", () => {
    expect(pushRecent(["a", "b", "c"], "b", 3)).toEqual(["b", "a", "c"]);
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });

  it("extracts the client from a namespace", () => {
    expect(clientOf("prod-acme-eu")).toBe("acme-eu");
    expect(clientOf("monitoring")).toBe("monitoring");
  });
});
