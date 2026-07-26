import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchJson, PROVIDER_CALL_BUDGET_MS } from "@/lib/http-client";

/**
 * The two budgets must never invert again.
 *
 * The production outage: `maxDuration` was set nowhere, so every function ran
 * on Vercel's default (10s Hobby / 15s Pro) — while `fetchJson` defaulted to
 * 30s x 3 attempts, allowing 90s for ONE provider call, plus a `Retry-After`
 * honored up to 60s on top. Work budgeted in minutes, container killed in
 * seconds. Every sync-touching function died mid-flight: the Test lane, the
 * per-connection sweep, webhook processing.
 *
 * It presented as a hang rather than an error because the run row is stamped
 * `running` before the work starts, so a kill stranded it there and the editor
 * polled for 90s about work that had already died.
 *
 * These are static/behavioral assertions rather than a live timing test: the
 * relationship between the numbers is the invariant, not any one value.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Routes that can do real work and therefore must declare a duration. */
const WORK_ROUTES = [
  "src/app/api/inngest/route.ts",
  "src/app/api/webhooks/[connectionId]/route.ts",
  "src/app/api/replay/route.ts",
  // Server actions inherit their page segment's duration; this one governs the
  // inline Test path and the provider-hitting option pickers.
  "src/app/dashboard/flows/page.tsx",
];

function declaredMaxDuration(path: string): number | null {
  const m = read(path).match(/^export const maxDuration = (\d+);/m);
  return m ? Number(m[1]) : null;
}

describe("serverless duration is declared wherever real work happens", () => {
  for (const route of WORK_ROUTES) {
    it(`${route} declares maxDuration`, () => {
      expect(
        declaredMaxDuration(route),
        `${route} does real work but declares no maxDuration, so it runs on the platform default ` +
          `(10s on Hobby). That is the outage: the function is killed mid-sync and the run is stranded.`,
      ).not.toBeNull();
    });
  }

  it("every declared duration leaves room for a full provider call", () => {
    for (const route of WORK_ROUTES) {
      const budget = declaredMaxDuration(route);
      expect(budget).not.toBeNull();
      expect(
        budget! * 1000,
        `${route} allows ${budget}s but one provider call may consume ` +
          `${PROVIDER_CALL_BUDGET_MS / 1000}s. The function would be killed mid-call.`,
      ).toBeGreaterThan(PROVIDER_CALL_BUDGET_MS);
    }
  });

  it("the Inngest entrypoint pins its runtime (it was the only route that didn't)", () => {
    expect(read("src/app/api/inngest/route.ts")).toContain('export const runtime = "nodejs"');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("one provider call cannot outlive the function running it", () => {
  it("exhausts retries within the stated per-call budget", async () => {
    let slept = 0;
    let attempts = 0;

    // Stub the real global fetch — the client has no injection seam, so this is
    // the only way to actually exercise the retry loop rather than a DNS error.
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempts++;
      throw new Error("network down");
    }));

    await expect(
      fetchJson("https://example.invalid/thing", {
        // Count the waits instead of serving them, so the test is instant.
        sleep: async (ms: number) => {
          slept += ms;
        },
      }),
    ).rejects.toThrow(/network down/);

    // The loop must have actually run, or this asserts nothing.
    expect(attempts).toBeGreaterThan(0);
    // Defaults: 2 attempts max (retries = 1), one backoff between them.
    expect(attempts).toBeLessThanOrEqual(2);

    const worstCase = attempts * 10_000 + slept;
    expect(
      worstCase,
      `worst case ${worstCase}ms exceeds the declared per-call budget of ${PROVIDER_CALL_BUDGET_MS}ms`,
    ).toBeLessThanOrEqual(PROVIDER_CALL_BUDGET_MS);
  });

  it("caps a hostile Retry-After instead of sleeping past the function budget", async () => {
    let slept = 0;
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempts++;
      return {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? "600" : null) },
        text: async () => "slow down",
        json: async () => ({}),
      } as unknown as Response;
    }));

    await expect(
      fetchJson("https://example.invalid/thing", { sleep: async (ms: number) => { slept += ms; } }),
    ).rejects.toThrow();

    expect(attempts).toBeGreaterThan(1); // it did retry the 429
    // The provider asked for 600s. Honoring that would kill the function; the
    // breaker's deferral is the right answer to a limit that long, not a sleep.
    expect(slept).toBeLessThanOrEqual(PROVIDER_CALL_BUDGET_MS);
  });
});
