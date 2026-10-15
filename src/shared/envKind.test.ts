import { describe, expect, it } from "vitest";
import { envTier, isProdLike } from "./envKind";

describe("environment tiers", () => {
  it("reads the tier from contexts and namespaces", () => {
    expect(envTier("prod.euc1.example.cloud")).toBe("prod");
    expect(envTier("preprod.acme.example.cloud")).toBe("preprod");
    expect(envTier("integration.example.cloud")).toBe("latest");
    expect(envTier("review-acme")).toBe("review");
    expect(envTier("uat-acme")).toBe("uat");
    expect(envTier("monitoring")).toBe("other");
  });

  it("does not match words that merely contain prod", () => {
    expect(envTier("products-api")).toBe("other");
    expect(envTier("reproduce")).toBe("other");
  });

  it("takes the most severe tier across names", () => {
    expect(envTier("review-acme", "integration.example.cloud")).toBe("review");
    expect(envTier("review-acme", "prod.euc1.example.cloud")).toBe("prod");
    expect(envTier(undefined, "prod.euc1.example.cloud")).toBe("prod");
    expect(envTier("prd1-eu")).toBe("prod");
    expect(envTier("preprod-acme")).toBe("preprod");
  });

  it("treats prod and preprod as production-like", () => {
    expect(isProdLike("prod")).toBe(true);
    expect(isProdLike("preprod")).toBe(true);
    expect(isProdLike("review")).toBe(false);
  });
});
