import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/**
 * NO PROBER SHIPS AS AN UNTOUCHED SCAFFOLD — and this is written after one did.
 *
 * `scripts/verify-fathom.ts` sat in the repo for two days pointing at
 * `https://api.example.com/v1`, sending `Authorization: Bearer`, hitting an
 * `/events` path, expecting a `{data:[]}` envelope and filtering on an
 * `updated_after` parameter Fathom does not have. Five facts, none of them
 * about Fathom. It would have "passed" against nothing.
 *
 * Meanwhile the connector itself was written carefully from the published docs
 * and every fact in it checks out — but a customer connected a real key and got
 * "0 loaded · No records returned", and nobody could say why, because THE
 * CONNECTOR HAD NEVER MADE A SINGLE LIVE REQUEST. `verified: { live: null }` in
 * the catalog was the only honest record of that, and it is a field nobody
 * reads when a connector looks finished.
 *
 * The tests above check that the GENERATOR emits a good scaffold. Nothing
 * checked that a scaffold ever stopped being one. That is this.
 */
describe("every prober has actually been written", () => {
  const dir = join(process.cwd(), "scripts");
  const probers = readdirSync(dir).filter((f) => /^verify-[a-z0-9-]+\.ts$/.test(f));

  it("finds the probers", () => {
    // Guards the loop below against passing on an empty list, which is what a
    // renamed directory would look like.
    expect(probers.length, "no verify-*.ts probers found — the checks below would be vacuous").toBeGreaterThan(10);
  });

  it("none still points at the scaffold's placeholder host or FILL-ME markers", () => {
    for (const file of probers) {
      /**
       * Comment-stripped, because the fixed Fathom prober explains the failure
       * in its own header and names the placeholder to do so. Banning the
       * WORDS would ban the explanation; what must not survive is the CODE.
       *
       * THE LOOKBEHIND IS LOAD-BEARING and the first version did not have it:
       * a naive `//` strip treats the slashes in `https://api.example.com` as
       * the start of a line comment, deletes the rest of the line, and the
       * check then passes on the exact string it exists to catch. Confirmed by
       * putting the placeholder back — it stayed green until this changed.
       */
      const code = readFileSync(join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      expect(code, `${file} still targets the scaffold's placeholder host`).not.toContain("api.example.com");
      expect(code, `${file} still carries a FILL-ME marker`).not.toContain("FILL-ME");
    }
  });
});
