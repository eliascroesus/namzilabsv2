/**
 * Print every connector with its provenance and verification state:
 *   pnpm connector:inventory
 */
import { CONNECTOR_CATALOG } from "../src/connectors/catalog";

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
console.log(`${pad("source", 12)} ${pad("connect", 8)} ${pad("in", 3)} ${pad("poll", 5)} ${pad("sync", 15)} ${pad("docs read", 11)} ${pad("live", 11)}`);
for (const e of CONNECTOR_CATALOG) {
  console.log(
    `${pad(e.source, 12)} ${pad(e.connect, 8)} ${pad(e.instant ? "y" : "-", 3)} ${pad(e.poll ? "y" : "-", 5)} ${pad(e.sync ?? (e.poll ? "incremental" : "webhook-only"), 15)} ${pad(e.docs?.readOn ?? "(legacy)", 11)} ${pad(e.verified ? (e.verified.live ?? "unprobed") : "(legacy)", 11)}`,
  );
}
