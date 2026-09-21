/**
 * Live probe for the Google Ads connector.
 *
 * Two things here are true of no other connector in this codebase and are what
 * this script exists to settle:
 *
 *   1. THE DEVELOPER TOKEN IS OURS, AND ITS DAILY CEILING IS THE WHOLE FLEET'S.
 *      Explorer allows 2,880 operations a day against production accounts,
 *      Basic 15,000, Standard unlimited. The catalog declares Explorer's 2/min
 *      because that is where a new project starts; this reports what the token
 *      actually is so the number can be raised when it changes.
 *   2. THE REST RESPONSE IS camelCase WHILE THE QUERY IS snake_case. Reading a
 *      field back under the name you asked for yields undefined, which becomes
 *      null, which renders as a blank tile rather than as an error — so the
 *      shape is asserted here against a real answer.
 *
 *   GOOGLE_ADS_ACCESS_TOKEN=ya29.… GOOGLE_ADS_DEVELOPER_TOKEN=… pnpm tsx scripts/verify-google-ads.ts
 *
 * An access token is short-lived; the quickest source is the OAuth Playground
 * (developers.google.com/oauthplayground) with the adwords scope, or the token
 * stored against a live connection.
 *
 * Read-only: it issues search requests and writes nothing.
 */
import { GOOGLE_ADS_API_VERSION } from "@/connectors/google-ads";

const API = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

type Check = { ok: boolean; label: string; note: string };
const results: Check[] = [];

function record(ok: boolean, label: string, note: string) {
  results.push({ ok, label, note });
  console.log(`${ok ? " OK  " : "FAIL "} ${label}\n        ${note}`);
}

function headers(token: string, dev: string, login?: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(dev ? { "developer-token": dev } : {}),
    "content-type": "application/json",
    ...(login ? { "login-customer-id": login } : {}),
  };
}

async function search(token: string, dev: string, customerId: string, query: string, login?: string) {
  const res = await fetch(`${API}/customers/${customerId}/googleAds:search`, {
    method: "POST",
    headers: headers(token, dev, login),
    body: JSON.stringify({ query, pageSize: 100 }),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* keep the raw text */
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function main() {
  const token = process.env.GOOGLE_ADS_ACCESS_TOKEN ?? process.env.GADS_API_KEY;
  // OPTIONAL SINCE 9 SEP 2026, when Google sunset developer tokens and moved
  // access onto the Cloud project. Empty is the normal, correct state.
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
  if (!token) {
    console.error("Set GOOGLE_ADS_ACCESS_TOKEN to an OAuth token carrying the adwords scope.");
    console.error("Access level lives on the Cloud project behind that token — check its Google Ads API Overview page.");
    process.exit(2);
  }
  console.log(`connector pins: ${GOOGLE_ADS_API_VERSION}\n`);

  // 1. The accounts this login reaches — the picker's first call.
  const listRes = await fetch(`${API}/customers:listAccessibleCustomers`, { headers: headers(token, dev) });
  const listText = await listRes.text();
  const roots: string[] = (() => {
    try {
      return (JSON.parse(listText) as { resourceNames?: string[] }).resourceNames ?? [];
    } catch {
      return [];
    }
  })();
  record(listRes.ok, "the access token is accepted and the project has API access", listRes.ok ? `${roots.length} accessible customer(s)` : `${listRes.status} ${listText.slice(0, 300)}`);
  if (!listRes.ok) {
    /**
     * The two failures worth naming, because Google's message for each is
     * opaque and the fixes are weeks apart.
     */
    if (listText.includes("DEVELOPER_TOKEN_NOT_APPROVED")) {
      console.error("\nThe developer token is not approved for production accounts yet — that is the Explorer/Basic application.");
    }
    if (listText.includes("invalid_grant") || listRes.status === 401) {
      console.error("\nThe access token is expired or lacks the adwords scope.");
    }
    process.exit(1);
  }

  const rootId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? roots[0] ?? "").replace(/^customers\//, "").replace(/-/g, "");
  if (!rootId) {
    console.error("\nNo accessible customer to probe.");
    process.exit(1);
  }

  // 2. The hierarchy expansion, and the manager exclusion the picker relies on.
  const hierarchy = await search(
    token,
    dev,
    rootId,
    "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, " +
      "customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.status = 'ENABLED'",
    rootId,
  );
  const clients = (hierarchy.json?.["results"] ?? []) as Record<string, unknown>[];
  record(hierarchy.ok, "customer_client expands the hierarchy", hierarchy.ok ? `${clients.length} client(s)` : hierarchy.text.slice(0, 300));
  if (clients.length > 0) {
    const sample = (clients[0]["customerClient"] ?? {}) as Record<string, unknown>;
    // THE camelCase PROOF. `descriptive_name` in the query, `descriptiveName`
    // in the answer — the whole reason `pick()` exists.
    record(
      "descriptiveName" in sample || "id" in sample,
      "the response is camelCase, as the connector assumes",
      `keys: ${Object.keys(sample).join(", ")}`,
    );
  }

  const leaf = clients
    .map((r) => (r["customerClient"] ?? {}) as Record<string, unknown>)
    .find((c) => c["manager"] !== true);
  const customerId = String(leaf?.["id"] ?? rootId);
  const login = customerId === rootId ? undefined : rootId;
  console.log(`\nprobing customer ${customerId}${login ? ` via manager ${login}` : ""}\n`);

  // 3. The reporting query the connector actually issues.
  const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const report = await search(
    token,
    dev,
    customerId,
    `SELECT campaign.id, campaign.name, campaign.advertising_channel_type, customer.currency_code, ` +
      `customer.time_zone, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, ` +
      `metrics.conversions, metrics.video_views FROM campaign ` +
      `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    login,
  );
  const rows = (report.json?.["results"] ?? []) as Record<string, unknown>[];
  record(report.ok, "the campaign report returns rows", report.ok ? `${rows.length} row(s)` : report.text.slice(0, 400));

  if (rows.length > 0) {
    const r = rows[0];
    const metrics = (r["metrics"] ?? {}) as Record<string, unknown>;
    const customer = (r["customer"] ?? {}) as Record<string, unknown>;
    record("costMicros" in metrics, "cost comes back as costMicros", `metrics keys: ${Object.keys(metrics).join(", ")}`);
    record("timeZone" in customer, "the customer's timezone rides along on every row", `time_zone=${customer["timeZone"]}`);
    record(
      typeof metrics["costMicros"] === "string",
      "cost_micros arrives as a STRING (an int64 in JSON)",
      `costMicros is a ${typeof metrics["costMicros"]} = ${metrics["costMicros"]}`,
    );
    const dates = new Set(rows.map((x) => String((x["segments"] as Record<string, unknown>)?.["date"])));
    record(dates.size > 0, "segments.date splits the report by day", `${dates.size} distinct date(s)`);

    // 4. YouTube is a channel type, not a second product.
    const channels = new Set(rows.map((x) => String((x["campaign"] as Record<string, unknown>)?.["advertisingChannelType"])));
    console.log(`        campaign types present: ${[...channels].join(", ")}`);
    if (!channels.has("VIDEO") && !channels.has("DEMAND_GEN")) {
      console.log("        (no YouTube campaigns on this account — the Video filter is unexercised here)");
    }
  } else {
    console.log("   (no spend in the last 14 days — row shape unchecked; re-run against an active account)");
  }

  console.log(
    "\nACCESS LEVEL — check it at ads.google.com/aw/apicenter.\n" +
      "  Explorer  2,880 ops/day  → catalog fleetLimits 2/min  (where a new project starts)\n" +
      "  Basic     15,000 ops/day → raise fleetLimits to 10/min\n" +
      "  Standard  unlimited      → raise or remove the fleet ceiling\n" +
      "  That ceiling is shared by EVERY customer, so it is the number that decides how many can connect.",
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  for (const f of failed) console.log(`  - ${f.label}: ${f.note}`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
