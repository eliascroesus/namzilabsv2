/**
 * C16 — the one spelling of the results-version wire tag.
 *
 * `/api/results-version` builds this string and `FreshnessPoller` compares
 * against it; a second hand-rolled `W/"${version}"` in the client component
 * would only need to drift by a byte (a missing quote, a strong tag instead
 * of weak) for every comparison to read as "changed" forever, or never.
 *
 * Zero imports, on purpose: this file has to be safe to pull into a
 * "use client" component without dragging a server-only module in behind it.
 */
export function resultsEtag(version: string): string {
  return `W/"${version}"`;
}
