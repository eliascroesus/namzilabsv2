import { describe, it, expect } from "vitest";
import { hashId, stableStringify } from "@/lib/ids";

describe("stable ids", () => {
  it("is deterministic regardless of key order", () => {
    const a = hashId("ns", { b: 2, a: 1, nested: { y: 1, x: 2 } });
    const b = hashId("ns", { nested: { x: 2, y: 1 }, a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("changes when data changes", () => {
    expect(hashId("ns", { a: 1 })).not.toBe(hashId("ns", { a: 2 }));
  });

  it("namespaces the id", () => {
    expect(hashId("webhook:conn1", { a: 1 }).startsWith("webhook:conn1:")).toBe(true);
  });

  it("sorts object keys deterministically", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});
