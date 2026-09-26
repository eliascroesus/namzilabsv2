import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { lockRow } from "@/lib/billing/locks";
import type { ResolvedPlan } from "@/lib/billing/resolve";
import type { FlowResultRow } from "@/components/flow-tile";

/**
 * WHAT A LOCKED METRIC LOOKS LIKE — its name, a lock, and a picture with no
 * data in it — and the three banners a plan can raise on the board.
 *
 * The server strips a locked row before it leaves (`billing-locks.test.ts`).
 * These pin the second wall: the tiles themselves refuse to draw a number for
 * a row marked locked, even one that somehow still carries its figures, so
 * inspect mode has nothing to find either way.
 */

const { FlowTile } = await import("@/components/flow-tile");
const { CustomTile } = await import("@/components/custom-tile");
const { LockedTile } = await import("@/components/billing/locked-tile");
const { PlanBanner } = await import("@/components/billing/plan-banner");

const ROW = {
  flowId: "f1",
  outputNodeId: "o1",
  status: "fresh",
  error: null,
  computedAt: new Date("2026-09-30T08:00:00Z"),
  tile: {
    name: "Cash collected",
    viz: "number",
    format: "number",
    value: 48213.77,
    series: [{ date: "2026-09-29", value: 6071.9 }],
    byRange: { "30d": { value: 9123.45, series: [{ date: "2026-09-29", value: 6071.9 }] } },
  } as Record<string, unknown>,
} satisfies FlowResultRow;
/** Every figure the row measured, spelled every way a formatter might print it. */
const FIGURES = ["48213", "48,213", "48.2", "9123", "9,123", "9.1K", "6071", "6,071", "6.1K"];
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);
const noFigures = (h: string) => {
  for (const f of FIGURES) expect(h, `a locked tile printed ${f}`).not.toContain(f);
};

describe("a locked metric on the board", () => {
  it("shows its name and a lock, and offers the upgrade", () => {
    const h = html(createElement(FlowTile, { row: lockRow(ROW), rangeKey: "30d" }));
    expect(h).toContain("Cash collected");
    expect(h).toContain("Upgrade to unlock");
    expect(h).toContain('aria-haspopup="dialog"');
  });

  it("prints no figure from the row — stripped, or marked locked with its numbers still on", () => {
    noFigures(html(createElement(FlowTile, { row: lockRow(ROW), rangeKey: "30d" })));
    noFigures(html(createElement(FlowTile, { row: { ...ROW, locked: true } as FlowResultRow, rangeKey: "30d" })));
  });

  it("and none in a custom view either", () => {
    for (const chart of ["number", "line", "bar"]) {
      const h = html(
        createElement(CustomTile, { chart, title: "Cash collected", rangeKey: "30d", source: { kind: "flow", tile: (ROW.tile as object), flowId: "f1", locked: true } }),
      );
      expect(h).toContain("Upgrade to unlock");
      noFigures(h);
    }
  });

  it("draws one fixed picture for every locked metric, so the picture itself says nothing", () => {
    const svg = (h: string) => h.slice(h.indexOf("<svg"), h.indexOf("</svg>"));
    const a = svg(html(createElement(LockedTile, { name: "Cash collected" })));
    const b = svg(html(createElement(LockedTile, { name: "Show rate" })));
    expect(a.length).toBeGreaterThan(20);
    expect(a).toBe(b);
  });
});

const NOW = new Date("2026-10-01T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const trial = (left: number): ResolvedPlan => ({ plan: "growth", source: "trial", state: "trialing", endsAt: days(left), lifetime: false });
const banner = (props: Partial<Parameters<typeof PlanBanner>[0]>) =>
  html(createElement(PlanBanner, { plan: null, lockedCount: 0, dismissHref: "/dashboard", now: NOW, ...props }));

describe("the plan banner", () => {
  it("says nothing while billing is off, or while all is well", () => {
    expect(banner({ plan: null })).toBe("");
    expect(banner({ plan: { plan: "scale", source: "subscription", state: "active", endsAt: null, lifetime: false } })).toBe("");
  });

  it("stays quiet through a trial until its last seven days", () => {
    expect(banner({ plan: trial(8) })).toBe("");
    const h = banner({ plan: trial(7) });
    expect(h).toContain("Your Growth trial ends in 7 days");
    expect(h).toContain('href="/dashboard/settings/billing"');
  });

  it("warns before any free time runs out — a launch gift or a code, not only a trial", () => {
    const h = banner({ plan: { plan: "growth", source: "launch", state: "granted", endsAt: days(5), lifetime: false } });
    expect(h).toContain("Your free Growth ends in 5 days");
    expect(h).toContain("Add a card");
    expect(banner({ plan: { plan: "growth", source: "code", state: "granted", endsAt: days(40), lifetime: false } })).toBe("");
    expect(banner({ plan: { plan: "scale", source: "manual", state: "granted", endsAt: null, lifetime: true } })).toBe("");
  });

  it("is red while a payment is failing", () => {
    const h = banner({ plan: { plan: "growth", source: "subscription", state: "past_due", endsAt: null, lifetime: false } });
    expect(h).toContain('role="alert"');
    expect(h).toMatch(/didn(&#x27;|')t go through/);
  });

  it("counts what a downgrade locked, and promises nothing was deleted", () => {
    const h = banner({ plan: { plan: "free", source: "free", state: "free", endsAt: null, lifetime: false }, lockedCount: 4 });
    expect(h).toContain("4 metrics are locked on the Free plan");
    expect(h).toMatch(/nothing (is|was) deleted/i);
    expect(banner({ plan: { plan: "free", source: "free", state: "free", endsAt: null, lifetime: false }, lockedCount: 1 })).toContain("1 metric is locked");
  });

  it("welcomes a trial or a code once, and can be dismissed back to the same board", () => {
    const h = banner({ plan: trial(30), welcome: "trial", dismissHref: "/dashboard?view=v1" });
    expect(h).toContain("Your 30-day Growth trial has started");
    expect(h).toContain('href="/dashboard?view=v1"');
    expect(banner({ plan: { plan: "growth", source: "code", state: "granted", endsAt: days(90), lifetime: false }, welcome: "code" })).toContain(
      "Code applied",
    );
  });
});

describe("publishing past the plan's metrics in the builder", () => {
  /**
   * `publishFlowAction` answers a refusal at the limit with `upgrade:
   * "metrics"`. The builder has no DOM test harness here, so this reads the
   * handler: that answer must open the upgrade dialog rather than land in the
   * ordinary publish-error strip beside a missing field.
   */
  const src = readFileSync("src/components/flow/flow-canvas.tsx", "utf8");

  it("opens the upgrade dialog on an upgrade answer", () => {
    expect(src).toMatch(/if \(r\.upgrade\)[\s\S]{0,120}setUpgradeMessage\(r\.error\)/);
    expect(src).toMatch(/<UpgradeDialog[\s\S]{0,200}upgrade=metrics/);
  });
});
