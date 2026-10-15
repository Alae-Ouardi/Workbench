import { describe, expect, it } from "vitest";
import { shortUrl, toUrl } from "./url";

describe("address bar", () => {
  it("understands ports, local hosts, domains and searches", () => {
    expect(toUrl("3000")).toBe("http://localhost:3000");
    expect(toUrl("localhost:5173/app")).toBe("http://localhost:5173/app");
    expect(toUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(toUrl("github.com/omnevo")).toBe("https://github.com/omnevo");
    expect(toUrl("https://example.com")).toBe("https://example.com");
    expect(toUrl("how to rebase")).toBe("https://www.google.com/search?q=how%20to%20rebase");
    expect(toUrl("   ")).toBeNull();
    expect(toUrl("http://")).toBeNull();
  });

  it("shortens addresses for titles", () => {
    expect(shortUrl("http://localhost:3000/")).toBe("localhost:3000");
    expect(shortUrl("https://github.com/a/b")).toBe("github.com/a/b");
  });
});
