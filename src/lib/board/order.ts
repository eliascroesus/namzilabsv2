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
