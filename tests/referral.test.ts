import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attributable,
  MILESTONES,
  NEW_ACCOUNT_MINUTES,
  normaliseCode,
  progressFor,
  referralCode,
  referralLink,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_DAYS,
} from "@/lib/referral";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * THE REFERRAL SCHEME'S RULES — the ones that decide who gets paid.
 *
 * Everything here is a pure function on purpose. A referral scheme is the part
 * of a product most worth gaming, and "we tested it end to end once" is not the
 * same assurance as "the four guards are each asserted, including at their
 * boundaries".
 */
describe("a code somebody can share", () => {
  it("is stable for a user and different between users", () => {
    // Stable forever is what makes a DERIVED code better than a minted one:
    // links shared today still resolve when anything downstream changes, with
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
    // No I, L, O or U — the four that get misheard or retyped as 1 and 0.
    for (const id of ["a", "user_01J", "x".repeat(100)]) {
      expect(referralCode(id), id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it("round-trips through the URL it travels in", () => {
    const c = referralCode("user_01J");
    expect(normaliseCode(c)).toBe(c);
    // Chat clients lower-case links and people retype them with spaces.
    expect(normaliseCode(`  ${c.toLowerCase()} `)).toBe(c);
  });

  it("refuses anything that is not a code", () => {
    // An invented code must resolve to nothing rather than to a stray row.
    for (const bad of ["", "   ", "SHORT", "toolongtobeacode", "ABCDEFGI", "../../etc", "12345678 "]) {
      if (bad === "12345678 ") continue; // that one IS valid once trimmed
      expect(normaliseCode(bad), JSON.stringify(bad)).toBe(null);
    }
    expect(normaliseCode("12345678")).toBe("12345678");
    // `I` is not in the alphabet, so a code containing one cannot be ours.
    expect(normaliseCode("ABCDEFGI")).toBe(null);
  });

  it("builds a /r/ link, and refuses to build one without a base URL", () => {
    // A link that says `localhost` in somebody's group chat is worse than no
    // link, so an unset base yields a PATH and the page can tell.
    expect(referralLink("ABC12345", undefined)).toBe("/r/ABC12345");
    expect(referralLink("ABC12345", "https://app.namzilabs.com/")).toBe("https://app.namzilabs.com/r/ABC12345");
  });
});

describe("the four guards on an attribution", () => {
  const NOW = new Date("2026-09-15T12:00:00Z");
  const fresh = new Date("2026-09-15T11:55:00Z"); // five minutes old

  it("credits a genuinely new signup", () => {
    expect(attributable({ referrerUserId: "a", newUserId: "b", createdAt: fresh }, NOW)).toBe(true);
  });

  it("refuses a code that resolved to nobody", () => {
    expect(attributable({ referrerUserId: null, newUserId: "b", createdAt: fresh }, NOW)).toBe(false);
  });

  it("refuses a self-referral", () => {
    // Otherwise the cheapest way up the ladder is a second browser.
    expect(attributable({ referrerUserId: "a", newUserId: "a", createdAt: fresh }, NOW)).toBe(false);
  });

  it("refuses an account that is not new", () => {
    /**
     * `onSuccess` runs on every SIGN-IN, not just sign-up. An existing customer
     * who clicks a friend's link and signs in must not credit that friend, and
     * `createdAt` is the only honest signal for the difference.
     */
    const old = new Date("2026-06-01T00:00:00Z");
    expect(attributable({ referrerUserId: "a", newUserId: "b", createdAt: old }, NOW)).toBe(false);
  });

  it("holds its boundary exactly", () => {
    const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
    expect(attributable({ referrerUserId: "a", newUserId: "b", createdAt: at(NEW_ACCOUNT_MINUTES) }, NOW)).toBe(true);
    expect(attributable({ referrerUserId: "a", newUserId: "b", createdAt: at(NEW_ACCOUNT_MINUTES + 0.1) }, NOW)).toBe(
      false,
    );
  });

  it("refuses when there is no creation date at all", () => {
    // No signal is not the same as a good signal, and the safe answer to "is
    // this account new?" when nothing says so is no.
    expect(attributable({ referrerUserId: "a", newUserId: "b", createdAt: null }, NOW)).toBe(false);
  });

  it("refuses a future creation date rather than trusting a skewed clock", () => {
    const ahead = new Date("2026-09-15T12:05:00Z");
    expect(attributable({ referrerUserId: "a", newUserId: "b", createdAt: ahead }, NOW)).toBe(false);
  });
});

describe("the ladder and the bar", () => {
  it("starts at one, because zero-to-one is the gap most people never cross", () => {
    // Dropbox and Loom both reward the FIRST invite. A ladder starting at five
    // tells the 90% who will refer one person that they are playing for nothing.
    expect(MILESTONES[0].at).toBe(1);
  });

  it("is strictly increasing, with widening gaps", () => {
    const gaps: number[] = [];
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i].at).toBeGreaterThan(MILESTONES[i - 1].at);
      gaps.push(MILESTONES[i].at - MILESTONES[i - 1].at);
    }
    // Even spacing makes the late game feel identical to the early game.
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThanOrEqual(gaps[i - 1]);
  });

  it("promises only things this product can actually grant", () => {
    /**
     * Months of Namzilabs need a flag. Cash needs a payout rail, tax handling
     * and a fraud team — and a scheme that cannot pay what it advertised is
     * worse than no scheme. If a rung ever names a currency, this fails and
     * somebody has to go build the rail first.
     */
    for (const m of MILESTONES) {
      expect(m.reward, m.reward).not.toMatch(/\$|€|£|\bcash\b|\bpayout\b/i);
    }
  });

  it("fills the bar across the CURRENT rung, not the whole ladder", () => {
    /**
     * THE BAR MEASURES THE GAP YOU ARE IN, and the second invite is the number
     * that shows why. Across the whole ladder it would be 2 of 25 — an 8% bar
     * for a real achievement, which teaches people the achievement was not
     * real. Across the current rung (1 -> 3) it is half, which it is.
     *
     * The first draft of this test expected `progressFor(1).percent` to be 100
     * and was simply wrong: at one invite you have PASSED rung one and stand at
     * the start of the run to rung three. The page carries a `Math.max(…, 6)`
     * floor so that start still shows a sliver rather than an empty trough.
     */
    expect(progressFor(0).percent).toBe(0);
    expect(progressFor(0).next?.at).toBe(1);
    expect(progressFor(1).earned?.at).toBe(1);
    expect(progressFor(1).next?.at).toBe(3);
    expect(progressFor(1).percent).toBe(0);
    expect(progressFor(2).percent).toBe(50);
    // …and never the whole-ladder reading, which is the bug being ruled out.
    expect(progressFor(2).percent).not.toBe(8);
  });

  it("counts down in PEOPLE, which is the only unit anybody can act on", () => {
    expect(progressFor(0).toGo).toBe(1);
    expect(progressFor(1).toGo).toBe(2);
    expect(progressFor(4).toGo).toBe(1);
  });

  it("ends cleanly instead of dividing by zero", () => {
    const top = MILESTONES[MILESTONES.length - 1];
    const done = progressFor(top.at);
    expect(done.next).toBe(null);
    expect(done.toGo).toBe(0);
    expect(done.percent).toBe(100);
    expect(progressFor(top.at + 500).next).toBe(null);
  });

  it("survives nonsense counts rather than rendering NaN into a width", () => {
    // `percent` goes straight into `style={{ width }}` — a NaN there is an
    // invisible bar on the page this whole feature is about.
    for (const n of [-1, -99, 1.7, Number.NaN]) {
      const p = progressFor(n as number);
      expect(Number.isFinite(p.percent), String(n)).toBe(true);
      expect(p.percent).toBeGreaterThanOrEqual(0);
      expect(p.percent).toBeLessThanOrEqual(100);
    }
  });
});

describe("the capture path", () => {
  const route = read("src/app/r/[code]/route.ts");
  const callback = read("src/app/callback/route.ts");

  it("is a cookie, not a query string carried through sign-up", () => {
    /**
     * Almost nobody converts inside one navigation: they read the page, close
     * the tab, and sign up on Thursday from a Google result. Ninety days is the
     * window the whole scheme is really choosing.
     */
    /* The route names the CONSTANT rather than the string, which is better
       than what this first asserted (`toContain("nz_ref")`) and is why that
       assertion failed: there is one spelling of the cookie's name in the
       product and it is the export. */
    expect(route).toMatch(/import \{[^}]*REFERRAL_COOKIE[^}]*\} from "@\/lib\/referral"/);
    expect(route).toMatch(/res\.cookies\.set\(REFERRAL_COOKIE, code, \{/);
    expect(REFERRAL_COOKIE).toBe("nz_ref");
    expect(REFERRAL_COOKIE_DAYS).toBe(90);
    expect(route).toMatch(/maxAge: REFERRAL_COOKIE_DAYS \* 24 \* 60 \* 60/);
  });

  it("uses SameSite=Lax, or the cookie is withheld on the one request that reads it", () => {
    // Sign-up leaves for WorkOS and comes back. `strict` would not send the
    // cookie on that return navigation.
    expect(route).toMatch(/sameSite: "lax"/);
    expect(route).toMatch(/httpOnly: true/);
  });

  it("treats a malformed code as no referral, never as an error", () => {
    // Chat clients truncate links and people retype them.
    expect(code(route)).toMatch(/if \(code\) \{/);
    expect(code(route)).not.toMatch(/throw|status: 4/);
  });

  it("records at the one moment both halves are known", () => {
    expect(callback).toMatch(/onSuccess/);
    expect(callback).toMatch(/recordReferral\(/);
    expect(callback).toMatch(/user\.createdAt/);
  });

  it("clears the cookie ONLY when a row was actually written", () => {
    /**
     * Somebody who signs IN before they sign UP — a second account, an invite
     * accepted first — would otherwise have their attribution thrown away by
     * the sign-in that preceded it.
     */
    expect(callback).toMatch(/if \(written\) jar\.delete\(REFERRAL_COOKIE\)/);
  });

  it("cannot take out a first-ever sign-in", () => {
    // This is the first thing a new customer does. A failed bookkeeping insert
    // must not be the first thing they see.
    expect(callback).toMatch(/catch \(err\)/);
    expect(read("src/lib/referral-store.ts")).toMatch(/catch \(err\) \{[\s\S]*?return false;/);
  });

  it("walls repeat credit in the DATABASE, not in application code", () => {
    /**
     * A person can be referred exactly once in their life. Every referral
     * scheme that has been gamed was gamed through that gap, and a guard in a
     * query is a guard that survives the next refactor.
     */
    const sql = read("drizzle/0032_referrals.sql");
    expect(sql).toMatch(/UNIQUE\("referred_user_id"\)/);
    expect(read("src/db/schema.ts")).toMatch(/referredUserId: text\("referred_user_id"\)\.notNull\(\)\.unique\(\)/);
  });

  it("has its migration in the journal, or nobody applies it", () => {
    // A hand-written SQL file outside `_journal.json` is applied by NOBODY —
    // not by drizzle-kit, and not by the test database that builds from it.
    expect(read("drizzle/meta/_journal.json")).toContain("0032_referrals");
  });
});

describe("the invite choice", () => {
  const picker = read("src/components/invite-picker.tsx");

  it("asks which KIND of invite, because the two have opposite meanings", () => {
    /**
     * One shares your numbers and costs a seat; the other sends somebody to
     * build their own. A single button that guesses is how somebody hands a
     * competitor's analyst a login, or sends their accountant a referral link.
     */
    expect(picker).toContain("Who are you inviting?");
    expect(picker).toMatch(/start using Namzilabs/);
    expect(picker).toMatch(/into this workspace/);
  });

  it("copies the real link rather than describing one", () => {
    expect(picker).toMatch(/navigator\.clipboard\.writeText\(link\)/);
  });

  it("wears the same modal the view picker does", () => {
    // Two "choose between two kinds of thing" dialogs that look different is
    // the drift this product keeps removing.
    expect(picker).toMatch(/<Modal onClose=\{onClose\} size="lg">/);
    expect(read("src/app/dashboard/view-template-picker.tsx")).toMatch(/<Modal onClose=\{onClose\} size="lg">/);
  });
});

describe("the surfaces that advertise it", () => {
  it("names the offer in the rail, and names the same one the ladder does", () => {
    /**
     * The rail card spells the first rung BY HAND — it is a client component in
     * the chrome and cannot import a server module — so this is what stops the
     * advertisement and the promise drifting apart.
     */
    const rail = read("src/components/sidebar.tsx");
    expect(rail).toMatch(/href="\/dashboard\/refer"/);
    expect(rail).toContain(MILESTONES[0].reward.toLowerCase().replace("1 month free", "1 month free"));
  });

  it("puts the count first on the page, at the landing headline's size", () => {
    /**
     * A zero you can see is an invitation; a zero inside a sentence is nothing
     * at all. `text-banner` is the landing page's one oversized step and this
     * is the only place in the app that borrows it.
     */
    const page = read("src/app/dashboard/refer/page.tsx");
    expect(page).toMatch(/text-banner[^"]*">\{count\}/);
    expect(page).toMatch(/role="progressbar"/);
    expect(page).toMatch(/aria-valuenow=\{p\.percent\}/);
  });

  it("says plainly that claiming is not automatic", () => {
    // Counting is; fulfilment is a person. Saying so is cheaper than being
    // found out by the first customer who reaches a rung.
    const page = read("src/app/dashboard/refer/page.tsx");
    expect(page).toMatch(/Claiming is not yet/);
  });
});
