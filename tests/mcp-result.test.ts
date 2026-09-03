import { describe, it, expect } from "vitest";
import { ok, fail, describe as describeText, truncate, PROVENANCE_SENTENCE, MAX_RESULT_BYTES, type ToolResult } from "@/lib/mcp/result";

describe("describe/ok/fail", () => {
  it("describe appends the provenance sentence", () => {
    expect(describeText("Lists workspaces.")).toBe(`Lists workspaces. ${PROVENANCE_SENTENCE}`);
  });
  it("ok mirrors structured content into the text field and structuredContent", () => {
    const r = ok({ a: 1 });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
  });
  it("fail returns one plain sentence, isError true, and no structuredContent", () => {
    expect(fail("Nope.")).toEqual({ content: [{ type: "text", text: "Nope." }], isError: true });
  });
});

describe("truncate", () => {
  it("leaves a small result untouched", () => {
    const r = ok({ records: [{ a: 1 }, { a: 2 }] });
    expect(r.structuredContent).toEqual({ records: [{ a: 1 }, { a: 2 }] });
  });

  it("does not touch a result with no structuredContent", () => {
    const r: ToolResult = { content: [{ type: "text", text: "hi" }] };
    expect(truncate(r)).toEqual(r);
  });

  it("shrinks a list field from the end until the JSON fits, and marks truncated", () => {
    const records = Array.from({ length: 5000 }, (_, i) => ({ id: i, note: "x".repeat(30) }));
    const r = ok({ records });
    expect(r.structuredContent?.truncated).toBe(true);
    expect((r.structuredContent?.records as unknown[]).length).toBeGreaterThan(0);
    expect((r.structuredContent?.records as unknown[]).length).toBeLessThan(records.length);
    expect(Buffer.byteLength(r.content[0].text, "utf8")).toBeLessThanOrEqual(MAX_RESULT_BYTES);
  });

  it("measures a multi-byte (emoji/CJK) payload in UTF-8 bytes, not UTF-16 length", () => {
    // Each "🎉" is 2 UTF-16 code units but 4 UTF-8 bytes; a payload sized to
    // stay under a `.length`-based cap can still be far over a byte-based one.
    const big = "🎉".repeat(20_000);
    const r = ok({ records: [{ note: big }, { note: "short" }] });
    expect(r.structuredContent?.truncated).toBe(true);
    expect(Buffer.byteLength(r.content[0].text, "utf8")).toBeLessThanOrEqual(MAX_RESULT_BYTES);
  });

  it("falls back to a floor message when there is no list field left to shrink", () => {
    const r = ok({ note: "x".repeat(200_000) });
    expect(r.structuredContent).toEqual({ truncated: true, message: "The result was too large to return; ask for a narrower range or fewer fields." });
    expect(Buffer.byteLength(r.content[0].text, "utf8")).toBeLessThanOrEqual(MAX_RESULT_BYTES);
  });
});
