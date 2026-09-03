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

  it("shrinks records from the end until the JSON fits, and marks truncated", () => {
    const records = Array.from({ length: 5000 }, (_, i) => ({ id: i, note: "x".repeat(30) }));
    const r = ok({ records });
    expect(r.structuredContent?.truncated).toBe(true);
    expect((r.structuredContent?.records as unknown[]).length).toBeGreaterThan(0);
    expect((r.structuredContent?.records as unknown[]).length).toBeLessThan(records.length);
    expect(Buffer.byteLength(r.content[0].text, "utf8")).toBeLessThanOrEqual(MAX_RESULT_BYTES);
    // records is oldest-to-newest-irrelevant list data (not a time axis) —
    // it shrinks from the END, so the SURVIVING rows are the earliest ones.
    const kept = r.structuredContent?.records as Array<{ id: number }>;
    expect(kept[0]).toEqual(records[0]);
  });

  it("shrinks groups from the end, the same as records", () => {
    const groups = Array.from({ length: 5000 }, (_, i) => ({ label: `g${i}`, value: i, note: "x".repeat(30) }));
    const r = ok({ groups });
    expect(r.structuredContent?.truncated).toBe(true);
    const kept = r.structuredContent?.groups as Array<{ label: string }>;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(groups.length);
    expect(kept[0]).toEqual(groups[0]);
  });

  it("shrinks series and days from the FRONT, keeping the most recent entries", () => {
    // A time series and a run of calendar days are both written oldest-first
    // — shrinking from the end (like records/groups) would throw away the
    // newest points, which is exactly backwards for "what happened lately".
    const series = Array.from({ length: 5000 }, (_, i) => ({ bucket: `2020-01-${i}`, value: i, note: "x".repeat(30) }));
    const r = ok({ series });
    expect(r.structuredContent?.truncated).toBe(true);
    const kept = r.structuredContent?.series as Array<{ bucket: string; value: number }>;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(series.length);
    // The LAST original entry (the newest) must survive; the FIRST (the
    // oldest) must not — the opposite of how records/groups shrink.
    expect(kept[kept.length - 1]).toEqual(series[series.length - 1]);
    expect(kept[0]).not.toEqual(series[0]);
    expect(Buffer.byteLength(r.content[0].text, "utf8")).toBeLessThanOrEqual(MAX_RESULT_BYTES);
  });

  it("shrinks days from the front too", () => {
    const days = Array.from({ length: 5000 }, (_, i) => ({ day: `2020-01-${i}`, value: i, note: "x".repeat(30) }));
    const r = ok({ days });
    expect(r.structuredContent?.truncated).toBe(true);
    const kept = r.structuredContent?.days as Array<{ day: string }>;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[kept.length - 1]).toEqual(days[days.length - 1]);
    expect(kept[0]).not.toEqual(days[0]);
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
