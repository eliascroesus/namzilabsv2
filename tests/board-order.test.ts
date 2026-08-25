import { describe, it, expect } from "vitest";
import { compareKeys, keyBetween, keysBetween, MAX_KEY_LEN, ORDER_DIGITS } from "@/lib/board/order";

/**
 * THE ORDER KEYS, AS ALGEBRA.
 *
 * Everything the board does with a drag rests on one property: the key handed
 * back is strictly between its two neighbours, so one row moves and nothing
 * else is rewritten. These check that property under randomised traffic rather
 * than on the handful of cases anyone would think to write down — a fractional
 * scheme fails at the edges (adjacent digits, deep towers, the head), and the
 * edges are exactly where a hand-picked example set is thinnest.
 */

/** The list, kept sorted the way the board keeps it. */
const sorted = (keys: string[]) => [...keys].sort(compareKeys);
const isStrictlyIncreasing = (keys: string[]) => keys.every((k, i) => i === 0 || compareKeys(keys[i - 1], k) < 0);

describe("a key sits strictly between its neighbours", () => {
  it("puts the first key in the middle of the space", () => {
    // Nothing either side, so it lands halfway: room to insert 18 times before
    // either end without growing a character.
    expect(keyBetween(null, null)).toBe("i");
  });

  it("answers the head, the tail and the middle", () => {
    const mid = keyBetween(null, null);
    expect(compareKeys(keyBetween(null, mid), mid)).toBeLessThan(0);
    expect(compareKeys(mid, keyBetween(mid, null))).toBeLessThan(0);
    const inner = keyBetween(mid, keyBetween(mid, null));
    expect(compareKeys(mid, inner)).toBeLessThan(0);
  });

  it("finds room between two ADJACENT digits, which is where a naive scheme dies", () => {
    // "i" and "j" have nothing between them at the first place, so the answer
    // has to descend a level rather than give up.
    const k = keyBetween("i", "j");
    expect(compareKeys("i", k)).toBeLessThan(0);
    expect(compareKeys(k, "j")).toBeLessThan(0);
  });

  it("keeps a shared prefix instead of restarting", () => {
    const k = keyBetween("aab", "aaz");
    expect(k.startsWith("aa")).toBe(true);
    expect(compareKeys("aab", k)).toBeLessThan(0);
    expect(compareKeys(k, "aaz")).toBeLessThan(0);
  });

  it("survives a thousand random insertions", () => {
    /**
     * The real test. A deterministic pseudo-random walk — no Math.random, so a
     * failure is reproducible — inserting at the head, the tail and every
     * interior gap, asserting the whole list stays strictly ordered after each
     * one and no key ever ends in the minimum digit.
     */
    let seed = 12345;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    let keys = [keyBetween(null, null)];
    for (let i = 0; i < 1000; i++) {
      const at = next(keys.length + 1);
      const a = at === 0 ? null : keys[at - 1];
      const b = at === keys.length ? null : keys[at];
      const k = keyBetween(a, b);
      keys = [...keys.slice(0, at), k, ...keys.slice(at)];
      expect(isStrictlyIncreasing(keys), `broke after ${i + 1} inserts at ${at}`).toBe(true);
      expect(k.endsWith(ORDER_DIGITS[0]), `key "${k}" ends in the minimum digit`).toBe(false);
    }
    // And the sort the board actually performs agrees with the insertion order.
    expect(sorted(keys)).toEqual(keys);
  });
});

describe("towers stay short", () => {
  /**
   * MEASURED, NOT ESTIMATED. Repeatedly inserting at one extreme is the worst
   * case for any fractional scheme, and the first implementation here bisected
   * toward the open end: 200 head drops produced a FORTY-ONE character key,
   * because halving a 36-wide gap hits the boundary in five steps and then has
   * to descend a level. Stepping one digit at a time against an open end walks
   * all eighteen instead, and the same 200 drops produce twelve.
   *
   * Twelve characters per 200 drops is roughly one per seventeen, so the
   * MAX_KEY_LEN ceiling is on the order of a thousand consecutive drops at the
   * same extreme of the same lane. The bound is asserted rather than the exact
   * number, so improving the scheme is not a test failure — but sixteen is
   * close enough to twelve that a regression to bisection cannot slip through.
   */
  it("grows about one character per seventeen head inserts, not one per five", () => {
    let head = keyBetween(null, null);
    for (let i = 0; i < 200; i++) head = keyBetween(null, head);
    expect(head.length).toBeLessThan(MAX_KEY_LEN);
    expect(head.length, `200 head inserts produced a ${head.length}-char key`).toBeLessThanOrEqual(16);
  });

  it("does the same at the tail, which is where appends land", () => {
    // The commoner of the two by far: every newly placed tile and every
    // "Move to" appends to the end of a lane.
    let tail = keyBetween(null, null);
    for (let i = 0; i < 200; i++) tail = keyBetween(tail, null);
    expect(tail.length).toBeLessThan(MAX_KEY_LEN);
    expect(tail.length, `200 tail inserts produced a ${tail.length}-char key`).toBeLessThanOrEqual(16);
  });

  it("stays inside the ceiling for a thousand appends", () => {
    // The guard is not decoration, but it must not fire during realistic use —
    // a lane holds tens of tiles, not thousands.
    let tail = keyBetween(null, null);
    for (let i = 0; i < 1000; i++) tail = keyBetween(tail, null);
    expect(tail.length).toBeLessThan(MAX_KEY_LEN);
  });
});

describe("keysBetween bisects rather than degenerating", () => {
  it("returns fifty short, strictly increasing keys", () => {
    const keys = keysBetween(null, null, 50);
    expect(keys).toHaveLength(50);
    expect(isStrictlyIncreasing(keys)).toBe(true);
    // Fifty SEQUENTIAL keyBetween calls would produce a tower — each one
    // inserting against the last. Halving the gap each time keeps the whole set
    // within a few characters instead.
    expect(Math.max(...keys.map((k) => k.length))).toBeLessThanOrEqual(4);
  });

  it("stays inside the bounds it was given", () => {
    const keys = keysBetween("i", "j", 10);
    expect(keys).toHaveLength(10);
    expect(isStrictlyIncreasing(keys)).toBe(true);
    expect(compareKeys("i", keys[0])).toBeLessThan(0);
    expect(compareKeys(keys[9], "j")).toBeLessThan(0);
  });

  it("is empty for a count of zero, rather than throwing", () => {
    // Re-homing an empty group's tiles calls this with n = 0.
    expect(keysBetween(null, null, 0)).toEqual([]);
  });
});

describe("the guards are not silent", () => {
  it("throws when the neighbours are out of order", () => {
    // The caller has passed neighbours that are not neighbours. The honest
    // answers are an exception now, or a lane that shuffles itself later.
    expect(() => keyBetween("z", "a")).toThrow(/out of order/);
    expect(() => keyBetween("i", "i")).toThrow(/out of order/);
  });

  it("throws on a key ending in the minimum digit", () => {
    // "x0" and "x" denote the same fraction, so allowing both would make two
    // strings mean one position and break the strict ordering everything rests on.
    expect(() => keyBetween("a0", null)).toThrow(/ends in/);
    expect(() => keyBetween(null, "a0")).toThrow(/ends in/);
  });
});

describe("the alphabet cannot disagree with a collation", () => {
  it("is digits then lowercase, with no uppercase anywhere", () => {
    /**
     * THE COLLATION TRAP, PINNED. Under `en_US.UTF-8` Postgres orders 'a' before
     * 'B'; under byte order 'B' comes first. Widening this alphabet to include
     * uppercase would make a board's order depend on which code path last
     * touched it — intermittently, and only for some keys.
     */
    expect(ORDER_DIGITS).not.toMatch(/[A-Z]/);
    for (let i = 1; i < ORDER_DIGITS.length; i++) {
      expect(compareKeys(ORDER_DIGITS[i - 1], ORDER_DIGITS[i])).toBeLessThan(0);
    }
  });

  it("disagrees with localeCompare on a case-mixed pair, so nobody simplifies it", () => {
    // If someone ever replaces compareKeys with localeCompare, this is the
    // assertion that explains why they must not.
    expect(compareKeys("B", "a")).toBeLessThan(0);
    expect("B".localeCompare("a", "en")).toBeGreaterThan(0);
  });
});
