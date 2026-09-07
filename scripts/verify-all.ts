/**
 * Runs every generated prober whose secret is present. Secrets arrive as
 * SECRETS_JSON (the workflow passes `toJSON(secrets)`) or as plain env vars.
 * Appends PASS|FAIL|SKIP lines to $RESULTS when set, as the bespoke steps do.
 *   pnpm tsx scripts/verify-all.ts
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { CONNECTOR_CATALOG } from "../src/connectors/catalog";

const BESPOKE = new Set(["close", "calendly", "instantly"]); // their own steps in the workflow
const secrets: Record<string, string> = process.env.SECRETS_JSON ? (JSON.parse(process.env.SECRETS_JSON) as Record<string, string>) : {};
const line = (s: string) => {
  console.log(s);
  if (process.env.RESULTS) appendFileSync(process.env.RESULTS, s + "\n");
};
let failed = 0;
for (const e of CONNECTOR_CATALOG) {
  if (BESPOKE.has(e.source)) continue;
  const script = `scripts/verify-${e.source}.ts`;
  if (!existsSync(script)) continue;
  const envName = `${e.source.toUpperCase().replace(/-/g, "_")}_API_KEY`;
  const key = process.env[envName] ?? secrets[envName];
  if (!key) {
    line(`SKIP|${e.name}|Secret ${envName} is not set on this repository.`);
    continue;
  }
  const r = spawnSync("pnpm", ["tsx", script], { stdio: "inherit", env: { ...process.env, [envName]: key } });
  if (r.status === 0) line(`PASS|${e.name}|No check contradicted the pinned contract — read the INFO lines.`);
  else {
    failed += 1;
    line(`FAIL|${e.name}|Script exited ${r.status} — see the ${e.name} output above.`);
  }
}
process.exit(failed > 0 ? 1 : 0);
