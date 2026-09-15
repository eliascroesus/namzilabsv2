import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { noticesFrom, NOTICE_LIMIT, type ConnectionRow, type MetricRow } from "@/lib/notices";
import { referralCode, referralLink } from "@/lib/referral";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with its prose removed — see the note on the `unread` assertion. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const NOW = new Date("2026-09-15T12:00:00Z");
const conn = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1",
  name: "Calendly",
  source: "calendly",
  status: "active",
  syncStatus: "synced",
  lastError: null,
  pausedUntil: null,
  pausedReason: null,
  ...over,
});
const metric = (over: Partial<MetricRow> = {}): MetricRow => ({
  id: "m1",
  flowId: "f1",
  name: "Meetings booked",
  error: null,
  ...over,
});

/**
 * WHAT THE BELL IS ALLOWED TO SAY.
 *
 * The bell shipped with `unread = 1` as a DEFAULT that nobody ever passed, so
 * every workspace carried a permanent blue "1" over a button that did nothing.
 * The fix is only as good as the rule behind it, and the rule is the whole
 * feature: which states are worth interrupting somebody for.
 */
describe("what counts as needing attention", () => {
  it("says nothing when nothing is wrong", () => {
    // The state most workspaces are in most of the time, and the one the old
    // badge could not express.
    expect(noticesFrom({ connections: [conn(), conn({ id: "c2" })], metrics: [] }, NOW)).toEqual([]);
  });

  it("raises a connection that is erroring, by either of its two status columns", () => {
    // `status` is the connection's own health; `syncStatus` is the data's. A
    // connection can be "active" and still be failing every sweep.
    expect(noticesFrom({ connections: [conn({ status: "error" })], metrics: [] }, NOW)).toHaveLength(1);
    expect(noticesFrom({ connections: [conn({ syncStatus: "error" })], metrics: [] }, NOW)).toHaveLength(1);
  });

  it("calls a paused connection a WARNING, not an error", () => {
    /**
     * `pausedUntil` is never terminal — the schema says so and the breaker
     * retries on its own. Saying "broken" about something that fixes itself in
     * an hour is how the panel loses the reader's trust for the notice
     * underneath it that will not.
     */
    const [n] = noticesFrom(
      { connections: [conn({ pausedUntil: new Date("2026-09-15T13:00:00Z"), pausedReason: "Rate limited." })], metrics: [] },
      NOW,
    );
    expect(n.severity).toBe("warn");
    expect(n.detail).toBe("Rate limited.");
  });

  it("forgets a pause that has already expired", () => {
    // The row keeps `pausedUntil` after the pause ends — it is a timestamp, not
    // a flag — so a rule that tested truthiness would report every connection
    // that was EVER paused, forever.
    expect(
      noticesFrom({ connections: [conn({ pausedUntil: new Date("2026-09-15T11:59:00Z") })], metrics: [] }, NOW),
    ).toEqual([]);
  });

  it("takes the clock as an argument so the boundary is testable at all", () => {
    const at = new Date("2026-09-15T12:00:00Z");
    const paused = conn({ pausedUntil: new Date("2026-09-15T12:00:01Z") });
    expect(noticesFrom({ connections: [paused], metrics: [] }, at)).toHaveLength(1);
    expect(noticesFrom({ connections: [paused], metrics: [] }, new Date("2026-09-15T12:00:02Z"))).toEqual([]);
  });

  it("stays quiet about importing, computing and merely stale", () => {
    /**
     * The same call `attentionOf` makes on the dashboard. An import reaching
     * backwards through history is expected work, and floating every
     * backfilling metric on the day a workspace connects an app would make the
     * bell useless exactly when it is most looked at.
     */
    for (const syncStatus of ["importing", "live", "synced", "outdated"]) {
      expect(noticesFrom({ connections: [conn({ syncStatus })], metrics: [] }, NOW), syncStatus).toEqual([]);
    }
  });

  it("puts the cause above the symptom", () => {
    /**
     * A broken connection is usually WHY the metric under it is broken, and a
     * list that leads with the symptom sends somebody to fix the wrong thing.
     * Errors before warnings, connections before metrics inside each.
     */
    const out = noticesFrom(
      {
        connections: [conn({ id: "warned", pausedUntil: new Date("2026-09-15T13:00:00Z") }), conn({ id: "broken", status: "error" })],
        metrics: [metric()],
      },
      NOW,
    );
    expect(out.map((n) => n.id)).toEqual(["conn:broken", "metric:m1", "conn:warned"]);
  });

  it("writes a sentence when the provider did not", () => {
    // `lastError` is frequently null — a connection can be marked error by a
    // sweep that had nothing quotable to say.
    const [n] = noticesFrom({ connections: [conn({ status: "error", lastError: null })], metrics: [] }, NOW);
    expect(n.detail).toMatch(/stopped working/);
    expect(n.detail).not.toBe("");
  });

  it("flattens and truncates whatever the provider DID say", () => {
    /**
     * Provider errors arrive as multi-line JSON with stack traces in them. At
     * full length one notice pushes every other one off the panel.
     */
    const ugly = `401 Unauthorized\n   {"error":"${"x".repeat(400)}"}`;
    const [n] = noticesFrom({ connections: [conn({ status: "error", lastError: ugly })], metrics: [] }, NOW);
    expect(n.detail).not.toContain("\n");
    expect(n.detail.length).toBeLessThanOrEqual(140);
    expect(n.detail.endsWith("…")).toBe(true);
  });

  it("names a metric that has lost its name rather than printing nothing", () => {
    const [n] = noticesFrom({ connections: [], metrics: [metric({ name: "   " })] }, NOW);
    expect(n.title).toBe("A published metric");
  });

  it("sends each notice somewhere you can act", () => {
    const out = noticesFrom({ connections: [conn({ status: "error" })], metrics: [metric()] }, NOW);
    expect(out.find((n) => n.kind === "connection")!.href).toContain("/integrations");
    expect(out.find((n) => n.kind === "metric")!.href).toBe("/dashboard/flows/f1");
  });
});

describe("the bell that used to lie", () => {
  const bar = read("src/components/top-bar.tsx");
  const bell = read("src/components/notifications.tsx");

  it("has no `unread` default left anywhere", () => {
    /**
     * THE BUG: `unread = 1` in the signature, never passed by any caller, so
     * the badge was a constant. The replacement defaults to an EMPTY LIST —
     * a notification count's failure mode must be "says nothing".
     *
     * COMMENTS STRIPPED, because the file's own notes NAME the prop they
     * stopped using. An assertion that cannot tell a symbol from a sentence
     * about a symbol forbids recording why the symbol went.
     */
    expect(code(bar)).not.toMatch(/unread/);
    expect(bar).toMatch(/notices = \[\]/);
  });

  it("counts real notices and opens a panel", () => {
    expect(bell).toMatch(/notices\.length/);
    expect(bell).toMatch(/onClick=\{\(\) => setOpen\(true\)\}/);
    expect(bell).toMatch(/<SheetContent/);
  });

  it("badges in the DANGER trio, not the brand", () => {
    // The brand fill is what this product uses for "press this next". A blue
    // dot on a bell reads as "new", which is the one thing none of these are.
    const badge = bell.slice(bell.indexOf("{count > 0 &&"), bell.indexOf("</Button>"));
    expect(badge).toContain("bg-destructive");
    expect(badge).not.toContain("bg-primary");
  });

  it("dresses the panel in the RAIL's tokens, so it is the left column on the right", () => {
    expect(bell).toMatch(/side="right"/);
    expect(bell).toMatch(/bg-rail\b/);
    expect(bell).toMatch(/border-rail-border/);
  });

  it("tells you when nothing is broken instead of showing an empty box", () => {
    // Most of the time this panel is empty, and "nothing is broken" is a thing
    // somebody opened it hoping to be told.
    expect(bell).toContain("Everything is running");
  });

  it("is read on the server and passed down, never fetched by the panel", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toMatch(/notices = await listNotices\(getDb\(\), orgId\)/);
    expect(shell).toMatch(/notices=\{notices\}/);
    // …and a failure is silence, not a broken frame.
    expect(shell).toMatch(/let notices: Notice\[\] = \[\];/);
    expect(bell).not.toMatch(/fetch\(|useEffect/);
  });

  it("stops at a limit and says so", () => {
    expect(NOTICE_LIMIT).toBeGreaterThan(0);
    expect(bell).toMatch(/hidden > 0/);
    expect(read("src/lib/notices.ts")).toMatch(/NOTICE_LIMIT \+ 1/);
  });
});

describe("a referral link somebody can actually share", () => {
  it("is stable for a user and different between users", () => {
    // Stable forever is the property that makes a DERIVED code better than a
    // minted one: links shared today still resolve when attribution lands, with
    // no backfill.
    expect(referralCode("user_01J")).toBe(referralCode("user_01J"));
    expect(referralCode("user_01J")).not.toBe(referralCode("user_01K"));
  });

  it("does not leak the id it came from", () => {
    const id = "user_01JQRSTUVWXYZ0123456789";
    expect(referralCode(id)).not.toContain("01JQ");
    expect(id).not.toContain(referralCode(id));
  });

  it("is eight characters a human can read down a phone line", () => {
    // No I, L, O or U: the four that get misheard or retyped as 1/0.
    for (const id of ["a", "user_01J", "x".repeat(100)]) {
      const c = referralCode(id);
      expect(c, id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it("refuses to build a link out of a missing base URL", () => {
    // A link that says `localhost` in somebody's tweet is worse than no link,
    // so an unset base yields a PATH and the page can tell.
    expect(referralLink("ABC12345", undefined)).toBe("/?ref=ABC12345");
    expect(referralLink("ABC12345", "https://app.namzilabs.com/")).toBe("https://app.namzilabs.com/?ref=ABC12345");
  });

  it("promises no reward, because there is no reward", () => {
    /**
     * The rail pushes this hard at the owner's ask. The page is what keeps that
     * push honest: nothing counts a signup yet and nothing pays out, so the
     * page says exactly that and names no percentage, no credit and no cash.
     */
    const page = read("src/app/dashboard/refer/page.tsx");
    expect(page).toMatch(/Rewards are not switched on yet/);
    expect(page).not.toMatch(/\d+%\s*(commission|of revenue|recurring)/i);
    expect(page).not.toMatch(/\$\d/);
  });
});
