/**
 * FRACTIONAL ORDER KEYS — how a tile knows where it sits in its column.
 *
 * A drag has to be ONE row update. Spaced integers give you that only until a
 * gap closes: with a gap of 1000, ten drops into the same slot force a renumber
 * of the whole lane, and that renumber is precisely the moment two people
 * dragging at once corrupt each other's work. A fractional key is computed from
 * the two neighbours the client is already holding, so one row moves and the
 * neighbours are never rewritten.
 *
 * THE ALPHABET IS LOWERCASE-ONLY, AND THAT IS THE WHOLE SAFETY ARGUMENT.
 * Base-62 would give ~15% shorter keys and would introduce the worst bug this
 * feature could ship: under `en_US.UTF-8` Postgres orders 'a' before 'B', under
 * byte order 'B' comes first. Digits-then-lowercase agrees under both, so the
 * scheme stays correct even if somebody later writes `ORDER BY pos` in SQL.
 *
 * Three layers, because a board whose order differs between two code paths —
 * intermittently, and only for some names — is close to undebuggable:
 *   1. this alphabet, which cannot disagree with itself;
 *   2. `COLLATE "C"` on the column (see drizzle/0026_dashboard_groups.sql);
 *   3. the app never sorts these in SQL at all. One org's placements are a few
 *      dozen tiny rows, read whole and ordered here.
 */
export const ORDER_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Byte order, spelled out.
 *
 * NOT `localeCompare`, and not `<` on a whim — this is the one comparison the
 * whole arrangement rests on, so it says what it means. `localeCompare` would
 * agree with this on the alphabet above and disagree the moment anyone widens
 * it, which is a trap set for a future change rather than a bug today.
 */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A KEY NEVER ENDS IN THE MINIMUM DIGIT.
 *
 * `"x0"` and `"x"` denote the same fraction, so allowing both would make two
 * different strings mean one position and break the strict ordering everything
 * here rests on. The rule is checked on the way in and never broken on the way
 * out, which is what lets `compareKeys` be a plain string comparison.
 */
const endsInZero = (k: string) => k.endsWith(ORDER_DIGITS[0]);

/**
 * The ceiling on a key's length, and the trigger for a rebalance.
 *
 * Only ever reached by pathological use — dropping repeatedly into the same
 * gap grows a key one character at a time, and 64 characters is tens of
 * thousands of such drops. It exists so the failure is an exception a caller
 * can answer rather than a column that quietly fills with kilobyte strings.
 */
export const MAX_KEY_LEN = 64;

const B = ORDER_DIGITS.length;

/**
 * A KEY STRICTLY BETWEEN TWO NEIGHBOURS — the whole reason a drag is one row
 * update.
 *
 * `a === null` means the head of the lane, `b === null` the tail. The result is
 * always strictly greater than `a` and strictly less than `b`, so the two
 * neighbours are never rewritten and two people dragging different tiles cannot
 * collide.
 *
 * It THROWS on an out-of-order pair rather than returning something plausible.
 * A guard that is silent is not a guard: the caller has passed neighbours that
 * are not neighbours, and the honest answers are an exception now or a lane
 * that shuffles itself later.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a != null && endsInZero(a)) throw new Error(`order key "${a}" ends in ${ORDER_DIGITS[0]}`);
  if (b != null && endsInZero(b)) throw new Error(`order key "${b}" ends in ${ORDER_DIGITS[0]}`);
  if (a != null && b != null && compareKeys(a, b) >= 0) throw new Error(`order keys out of order: "${a}" >= "${b}"`);
  const key = between(a ?? "", b);
  if (key.length > MAX_KEY_LEN) throw new Error(`order key exhausted between "${a}" and "${b}"`);
  return key;
}

/**
 * `a` is a string of fractional digits ("" is the head, 0.000…); `b` is the
 * same or null for the tail (1.0). Each call either lands on a digit strictly
 * between the two, or fixes one digit and recurses on what is left — so the
 * recursion is bounded by the longer input.
 */
function between(a: string, b: string | null): string {
  const headOpen = a.length === 0;
  const tailOpen = b == null || b.length === 0;
  const da = headOpen ? 0 : ORDER_DIGITS.indexOf(a[0]);
  const db = b != null && b.length > 0 ? ORDER_DIGITS.indexOf(b[0]) : B;

  /**
   * AGAINST AN OPEN END, STEP ONE DIGIT — do not bisect toward it.
   *
   * This is the difference between a key that grows a character every FIVE
   * drops at an extreme and one that grows every EIGHTEEN, and appending is by
   * far the commonest thing that happens to a lane: every newly placed tile,
   * every "Move to", every drop at the bottom of a column.
   *
   * Bisecting looks like the obvious rule and is the wrong one here. Halving a
   * 36-wide gap reaches the boundary in five steps and then has to descend a
   * level; stepping by one uses all eighteen digits on the way. Measured: 200
   * consecutive drops at the head produced a 41-character key under bisection
   * and twelve under this.
   *
   * Only when the OTHER side is bounded. With both ends open there is no
   * boundary to walk toward and the midpoint is right — that is the first key
   * in an empty lane, which wants room on both sides.
   */
  if (headOpen && !tailOpen && db >= 2) return ORDER_DIGITS[db - 1];
  if (tailOpen && !headOpen && da + 1 < B) return ORDER_DIGITS[da + 1];

  // ROOM FOR A DIGIT OF ITS OWN — the ordinary case, and the one that keeps
  // keys short. The midpoint is strictly inside the gap, so it cannot be the
  // minimum digit and cannot equal either neighbour.
  if (db - da >= 2) return ORDER_DIGITS[Math.floor((da + db) / 2)];

  // The same digit: the answer shares it, and the question moves one place
  // right. `keyBetween("aab", "aaz")` is `"aa" + between("b", "z")`.
  if (da === db) return ORDER_DIGITS[da] + between(a.slice(1), b == null ? null : b.slice(1));

  // Consecutive digits, so nothing fits between them at this place. Descend
  // into `a`'s digit and go UP from there: anything starting with a's digit is
  // below anything starting with b's, so the tail is unconstrained above.
  return ORDER_DIGITS[da] + between(a.slice(1), null);
}

/**
 * `n` keys strictly between two neighbours, BY BISECTION.
 *
 * Not `n` sequential `keyBetween` calls. Each of those would insert against the
 * one before it, which is the degenerate case that grows a tower one character
 * per key — fifty tiles would end in fifty-character keys. Halving the gap each
 * time keeps them logarithmic instead: fifty keys come out no longer than two
 * characters.
 *
 * Used wherever a whole lane is written at once — seeding an order that has
 * never been dragged, re-homing a deleted group's tiles, and rebalancing.
 */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  const half = Math.floor(n / 2);
  const mid = keyBetween(a, b);
  return [...keysBetween(a, mid, half), mid, ...keysBetween(mid, b, n - half - 1)];
}
