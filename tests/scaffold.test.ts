import { describe, it, expect } from "vitest";
import { renderScaffold } from "../scripts/new-connector";

describe("the connector scaffold", () => {
  const out = renderScaffold({ source: "acme", name: "Acme", auth: "apiKey", instant: true, poll: true, stream: null, today: "2026-09-07" });
  it("emits five files at the expected paths", () => {
    expect(Object.keys(out).sort()).toEqual(
      ["scripts/verify-acme.ts", "src/connectors/acme.ts", "tests/acme.test.ts", "catalog-entry.txt", "registry-line.txt"].sort(),
    );
  });
  it("the connector compiles against the kit and fails closed", () => {
    const c = out["src/connectors/acme.ts"];
    expect(c).toContain('source: "acme"');
    expect(c).toContain('authType: "apiKey"');
    expect(c).toContain("if (!secret) return false");
    expect(c).toContain("windowedWalk<");
    expect(c).toContain('from "./kit"');
  });
  it("the catalog entry carries the marker the population test rejects until it is filled", () => {
    const e = out["catalog-entry.txt"];
    expect(e).toContain('readOn: "FILL-ME"');
    expect(e).toContain("verified: { live: null }");
    expect(e).toContain("brand: { color:");
  });
  it("a stream-scoped scaffold declares the flow field", () => {
    const s = renderScaffold({ source: "acme", name: "Acme", auth: "apiKey", instant: false, poll: true, stream: "formId", today: "2026-09-07" });
    expect(s["catalog-entry.txt"]).toContain('key: "formId"');
    expect(s["src/connectors/acme.ts"]).toContain("listOptions(");
  });
});
