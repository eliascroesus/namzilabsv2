/**
 * Whether a row — or a tile — was marked locked by `lockRow`.
 *
 * ITS OWN FILE BECAUSE THE BROWSER NEEDS IT. The tiles that refuse to draw a
 * locked figure run on the client (`custom-tile.tsx` pulls `flow-tile.tsx` in
 * through the chart frame), and `locks.ts` imports the database schema. This
 * imports nothing.
 */
export function isLockedRow(row: unknown): boolean {
  return Boolean(row && typeof row === "object" && (row as { locked?: unknown }).locked === true);
}
