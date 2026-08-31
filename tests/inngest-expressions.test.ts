import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { functions } from "@/inngest/functions";
import { PLAN_MAX_CONCURRENCY } from "@/inngest/client";

/**
 * EVERY INNGEST EXPRESSION IS CEL, AND CEL IS NOT JAVASCRIPT.
 *
 * THE OUTAGE THIS EXISTS TO PREVENT, WHICH ALREADY HAPPENED. Three function
 * configs used `??` for a default — `event.data.priority ?? 0` and friends.
 * Inngest compiles those strings as CEL (Google's expression language), which
 * has no null-coalescing operator, so each one failed to compile.
 *
 * A REJECTED SYNC IS TOTAL, NOT PARTIAL. Inngest refuses the whole app, so
 * every function added after the last good sync silently never registered.
 * FOUR of TWELVE were live for an unknown period: no backfills, no "Sync now",
 * no reprocess, no storage retention, and no `scanInvariants` — which lives
 * inside `prune-storage`, so the watchdog went down with the things it watches
 * and nothing anywhere said a word.
 *
 * WHY THE EXISTING TEST DID NOT CATCH IT, which is the real lesson.
 * `inngest-config.test.ts` asserted `priority` equalled `"event.data.priority
 * ?? 0"` — it pinned the SPELLING of a value nobody had validated, so it
 * faithfully protected the bug. A config test that compares against a literal
 * proves only that the literal has not changed. This file checks the GRAMMAR,
 * which is the property that actually has to hold.
 */

/** The exact options object the SDK hangs on every function. */
const opts = (fn: unknown) => (fn as { opts: Record<string, unknown> }).opts;

/**
 * Every string in a function's config that Inngest will COMPILE, gathered from
 * the shapes that can carry one. Read off the live `functions` array rather
 * than by grepping source, so a new function is covered the moment it is
 * registered — the failure mode here was precisely a function nobody checked.
 */
function expressionsOf(fn: unknown): Array<{ where: string; expr: string }> {
  const o = opts(fn);
  const id = String(o.id);
  const out: Array<{ where: string; expr: string }> = [];
  const push = (where: string, v: unknown) => {
    if (typeof v === "string") out.push({ where: `${id}.${where}`, expr: v });
  };
  push("idempotency", o.idempotency);
  for (const [name, val] of Object.entries(o)) {
    if (val == null || typeof val !== "object") continue;
    for (const entry of Array.isArray(val) ? val : [val]) {
      if (entry == null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      // `key` on concurrency/debounce/singleton/throttle, `run` on priority.
      push(`${name}.key`, e.key);
      push(`${name}.run`, e.run);
    }
  }
  return out;
}

const ALL = functions.flatMap(expressionsOf);

/**
 * JavaScript-isms that are NOT CEL. Each one compiles fine in the editor, reads
 * perfectly to a reviewer, and rejects the entire app at sync time.
 *
 * `??` is the one that actually bit. The rest are the same mistake wearing
 * different syntax — a reviewer who would wave through `?? 0` waves through
 * `?.` and `===` too, because all three are correct TypeScript sitting inside a
 * string that TypeScript never reads.
 */
const NOT_CEL: Array<{ pattern: RegExp; what: string; instead: string }> = [
  { pattern: /\?\?/, what: "the ?? operator", instead: "guarantee the sender always sets the field, or use a CEL ternary: has(x) ? x : default" },
  { pattern: /\?\./, what: "optional chaining (?.)", instead: "has(event.data.x) ? event.data.x : default" },
  { pattern: /===|!==/, what: "strict equality (=== / !==)", instead: "== and != — CEL has no strict variants" },
  { pattern: /=>/, what: "an arrow function", instead: "a plain expression; CEL has no closures" },
  { pattern: /`/, what: "a template literal", instead: "string concatenation with +" },
  { pattern: /\$\{/, what: "template interpolation", instead: "a CEL expression built from event fields" },
  { pattern: /\|\||&&(?!&)/, what: "|| or && used as a DEFAULT", instead: "these are boolean-only in CEL; a ternary is what you want" },
];

describe("every registered function's expressions are valid CEL", () => {
  it("finds expressions to check at all", () => {
    // A guard on the guard: if `expressionsOf` stops finding anything — a shape
    // change in the SDK, a rename — this file would pass by inspecting nothing.
    expect(ALL.length).toBeGreaterThan(8);
  });

  it.each(NOT_CEL)("uses no $what", ({ pattern, what, instead }) => {
    const bad = ALL.filter((e) => pattern.test(e.expr));
    expect(
      bad,
      bad.length === 0
        ? ""
        : `Inngest compiles these as CEL, which does not support ${what}. ` +
          `A failed compile rejects the WHOLE app sync, so every function stops registering — ` +
          `not just this one. Offending: ${bad.map((b) => `${b.where} = ${JSON.stringify(b.expr)}`).join(", ")}. ` +
          `Instead: ${instead}.`,
    ).toEqual([]);
  });

  it("references only event data, constants, or the async source", () => {
    /**
     * A positive check beside the negative ones, because a banned-list can only
     * ever catch the mistakes somebody thought of. An expression that reaches
     * for anything other than the event is either a typo or a misunderstanding
     * about what Inngest can see at scheduling time — it has the event, and
     * nothing else.
     */
    for (const { where, expr } of ALL) {
      const bare = expr.replace(/'[^']*'|"[^"]*"|-?\d+(\.\d+)?|\s|[?:()+\-*/<>=!,]|has|true|false|null/g, "");
      const refs = bare.split(/(?=event\.)/).filter(Boolean);
      for (const r of refs) {
        expect(r, `${where} reads ${JSON.stringify(r)}, which Inngest cannot see when it schedules`).toMatch(
          /^(event\.(data|name|ts|id)[\w.]*|async\.[\w.]*)$/,
        );
      }
    }
  });
});

/**
 * NO FUNCTION MAY OUTRUN THE PLAN, for exactly the reason the CEL check exists.
 *
 * Inngest refuses to sync an app whose functions declare more concurrency than
 * the account allows — and the refusal is TOTAL. `reconcile-one-connection`
 * declared 10 against a plan limit of 5, so the app would not sync AT ALL, which
 * is the same outage the `??` expressions caused arriving through a different
 * door. `run-flow-test` was sitting at 6 behind it, ready to reject the next
 * attempt after the first was fixed.
 *
 * Both facts — the ceiling, and every function obeying it — are checked here so
 * the next one fails in CI rather than in the Resync dialog.
 */
describe("no function declares more concurrency than the plan allows", () => {
  /** Every `limit` on every concurrency entry, global and per-key alike. */
  const limits = functions.flatMap((fn) => {
    const o = opts(fn);
    const c = o.concurrency;
    if (c == null) return [];
    return (Array.isArray(c) ? c : [c]).map((e) => ({
      id: String(o.id),
      key: (e as { key?: string }).key ?? "(global)",
      limit: Number((e as { limit: number }).limit),
    }));
  });

  it("checks something", () => {
    expect(limits.length).toBeGreaterThan(5);
  });

  it.each(limits)("$id / $key stays within the plan", ({ id, key, limit }) => {
    expect(
      limit,
      `${id} declares concurrency ${limit} on ${key}, above the plan's ${PLAN_MAX_CONCURRENCY}. ` +
        `Inngest rejects the WHOLE app sync for this, so every function stops registering. ` +
        `Either lower it, or raise PLAN_MAX_CONCURRENCY in the same commit that upgrades the plan.`,
    ).toBeLessThanOrEqual(PLAN_MAX_CONCURRENCY);
  });

  it("keeps a per-tenant cap under every global one, so no org can monopolise", () => {
    /**
     * The property that makes lowering the global cap free: for a single
     * workspace the PER-KEY cap is what binds, so the global number could
     * change without changing behaviour. That is only true while every
     * multi-entry function actually has a key cap — if one loses it, the global
     * limit becomes the tenant limit and one org can take the whole lane.
     */
    for (const fn of functions) {
      const c = opts(fn).concurrency;
      if (!Array.isArray(c) || c.length < 2) continue;
      const keyed = c.filter((e) => (e as { key?: string }).key != null);
      expect(keyed.length, `${String(opts(fn).id)} has a global cap but no per-tenant cap`).toBeGreaterThan(0);
      for (const k of keyed) {
        expect((k as { limit: number }).limit).toBeLessThanOrEqual(PLAN_MAX_CONCURRENCY);
      }
    }
  });
});

/**
 * THE HALF THAT MAKES DROPPING THE DEFAULTS SAFE.
 *
 * Removing `?? 0` is only correct if the field is always there. That was TRUE
 * for all three — each event has exactly one sender and each always sets the
 * field — but "true today" is not a property, it is an observation. These pin
 * it, so a second sender that forgets the field fails here rather than at
 * runtime, where a null concurrency key or priority is a silently mis-scheduled
 * run rather than an error anybody sees.
 */
describe("every sender supplies the field its function's expression reads", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("ingest/raw.received carries orgId, for the per-tenant concurrency cap", () => {
    const route = read("src/app/api/webhooks/[connectionId]/route.ts");
    expect(route).toMatch(/name: "ingest\/raw\.received", data: \{[^}]*orgId/);
  });

  it("ingest/reconcile.requested carries priority, for the sweep lane", () => {
    const reconcile = read("src/inngest/functions/reconcile.ts");
    const send = reconcile.slice(reconcile.indexOf('name: "ingest/reconcile.requested"'));
    expect(send.slice(0, 600)).toMatch(/priority: 0/);
  });

  it("flow/test.requested carries priority, for the interactive lane", () => {
    const actions = read("src/app/dashboard/flows/actions.ts");
    expect(actions).toMatch(/name: "flow\/test\.requested", data: \{[^}]*priority: 180/);
  });

  it("each of those events still has exactly ONE sender", () => {
    /**
     * The assertions above check the senders that exist. This checks that no
     * OTHER one appeared — because a second sender is exactly how a field that
     * "is always set" stops being always set, and the expressions above have no
     * fallback any more.
     */
    const files = [
      "src/app/api/webhooks/[connectionId]/route.ts",
      "src/inngest/functions/reconcile.ts",
      "src/app/dashboard/flows/actions.ts",
      "src/inngest/functions/process-event.ts",
      "src/inngest/functions/test-run.ts",
      "src/inngest/functions/sync.ts",
      "src/lib/connections.ts",
      "src/app/integrations/actions.ts",
    ].map(read);
    for (const [event, expected] of [
      ["ingest/raw.received", 1],
      ["ingest/reconcile.requested", 1],
      ["flow/test.requested", 1],
    ] as const) {
      // Sends only — the `triggers:` declaration names the same string.
      const sends = files.reduce(
        (n, f) => n + (f.match(new RegExp(`name: "${event.replace("/", "\\/")}"(?![\\s\\S]{0,40}triggers)`, "g")) ?? []).length,
        0,
      );
      expect(sends, `${event} gained a sender — check it sets the field the expression reads`).toBe(expected);
    }
  });
});
