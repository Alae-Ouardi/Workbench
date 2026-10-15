import { describe, expect, it } from "vitest";
import type { K8sObject } from "../types";
import { applyEvents } from "./useWatchList";

const obj = (uid: string, rv: string): K8sObject => ({ metadata: { name: uid, uid, resourceVersion: rv } });

describe("watch events", () => {
  it("adds, updates and deletes by uid without mutating the input", () => {
    const start = new Map([["a", obj("a", "1")]]);
    const next = applyEvents(start, [
      { type: "MODIFIED", object: obj("a", "2") },
      { type: "ADDED", object: obj("b", "1") },
      { type: "DELETED", object: obj("a", "3") },
      { type: "BOOKMARK", object: obj("x", "9") },
    ]);
    expect([...next.keys()]).toEqual(["b"]);
    expect(start.get("a")!.metadata.resourceVersion).toBe("1");
  });
});
