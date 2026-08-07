import { describe, it, expect, afterEach, vi } from "vitest";
import { normalizeDatesDeep } from "@/lib/normalize-dates";
import { compileEnabled } from "@/lib/flow/compile/flags";

/**
 * O6 — the engine's memory wins and rollout flags.
 *
 * normalizeDatesDeep runs on the read path over every loaded row (up to
 * APP_LOAD_CEILING per node) and used to allocate a fresh object tree even
 * when every value passed through untouched — the overwhelmingly common case,
 * since writer-written rows are normalized at ingest. Copy-on-write returns
 * the INPUT IDENTITY on the clean path; outputs are byte-identical either
 * way (the parity suite pins that), so this deletes one full copy per row
 * with zero semantic delta.
 */
describe("normalizeDatesDeep copy-on-write", () => {
  it("returns the INPUT OBJECT when nothing needed rewriting", () => {
    const clean = { name: "Ana", count: 3, when: "2026-07-21T14:23:45.000Z", nested: { tag: "x" } };
    // THE identity assertion: old code failed this — it always allocated.
    expect(normalizeDatesDeep(clean)).toBe(clean);
  });

  it("returns a NEW object when a value is rewritten, and never mutates the input", () => {
    const dirty = { when: "7/21/2026 14:23:45", keep: "as-is" };
    const out = normalizeDatesDeep(dirty);
    expect(out).not.toBe(dirty);
    expect(out.when).toBe("2026-07-21T14:23:45.000Z");
    expect(out.keep).toBe("as-is");
    expect(dirty.when).toBe("7/21/2026 14:23:45"); // input untouched
  });

  it("copies only the branch that changed — clean siblings keep their identity", () => {
    const cleanChild = { tag: "x", n: 1 };
    const dirty = { child: cleanChild, when: "7/21/2026 14:23:45" };
    const out = normalizeDatesDeep(dirty);
    expect(out).not.toBe(dirty);
    expect(out.child).toBe(cleanChild);
  });

  it("__-prefixed engine stamps pass through untouched, identity preserved", () => {
    const props = { __count_n1: 5, __passed_n1: true, plain: "text" };
    expect(normalizeDatesDeep(props)).toBe(props);
  });
});

/**
 * E.4 rollout flags — the DB_DRIVER two-flag pattern: Test surface soaks
 * first, materialize flips only under the full flag, both default off.
 */
describe("compileEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults OFF everywhere — today's behavior until an operator decides", () => {
    vi.stubEnv("ENGINE_COMPILE", "");
    vi.stubEnv("ENGINE_COMPILE_TEST", "");
    expect(compileEnabled("test")).toBe(false);
    expect(compileEnabled("materialize")).toBe(false);
  });

  it("ENGINE_COMPILE_TEST enables the Test surface ONLY (the soak seam)", () => {
    vi.stubEnv("ENGINE_COMPILE_TEST", "1");
    expect(compileEnabled("test")).toBe(true);
    // The numbers customers see stay on the proven path during the soak.
    expect(compileEnabled("materialize")).toBe(false);
  });

  it("ENGINE_COMPILE enables everything", () => {
    vi.stubEnv("ENGINE_COMPILE", "1");
    expect(compileEnabled("test")).toBe(true);
    expect(compileEnabled("materialize")).toBe(true);
  });
});
