/**
 * Live probe for the Meta Ads connector, in the shape of the other verify-* scripts.
 *
 * Nothing in the test suite touches Meta: a stubbed fetch answers whatever it is
 * asked, so it can prove the connector's OWN logic and nothing about the
 * provider. This script is where Meta's half gets checked — and in particular
 * the three claims the catalog entry currently makes on documentation alone:
 *
 *   1. Which Marketing API ACCESS TIER this app is on, which decides both the
 *      rate limit (60 points/300s vs 9,000) and — per Meta's access-token
 *      guide — whether long-lived tokens expire at all.
 *   2. Whether the token we hold is long-lived, and how long it has left.
 *   3. That the insights edge returns the fields the connector reads, with
 *      `time_increment=1` producing one row per day.
 *
 *   META_ADS_TOKEN=EAA… META_AD_ACCOUNT=act_123 pnpm tsx scripts/verify-meta-ads.ts
 *
 * Read-only: it issues GETs and writes nothing.
 */
import { META_GRAPH, META_GRAPH_VERSION } from "@/connectors/meta-ads";

type Check = { ok: boolean; label: string; note: string };
const results: Check[] = [];

function record(ok: boolean, label: string, note: string) {
  results.push({ ok, label, note });
  console.log(`${ok ? " OK  " : "FAIL "} ${label}\n        ${note}`);
}

async function get(path: string, params: Record<string, string>) {
  const url = new URL(`${META_GRAPH}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* keep the raw text */
  }
  return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

async function main() {
  const token = process.env.META_ADS_TOKEN ?? process.env.META_ADS_API_KEY;
  if (!token) {
    console.error("Set META_ADS_TOKEN to an access token with ads_read.");
    console.error("Quickest source: developers.facebook.com/tools/explorer — pick your app, add ads_read, Generate.");
    process.exit(2);
  }
  console.log(`connector pins: ${META_GRAPH_VERSION}\n`);

  // 1. The pinned version is accepted, and the token is what we think it is.
  const me = await get("/me", { access_token: token, fields: "id,name" });
  record(
    me.ok,
    `the pinned version ${META_GRAPH_VERSION} is accepted`,
    me.ok ? `token belongs to ${JSON.stringify(me.json?.["name"] ?? me.json?.["id"])}` : `${me.status} ${me.text.slice(0, 200)}`,
  );
  if (!me.ok) {
    console.error("\nStopping: the token or the version is wrong, so nothing below would mean anything.");
    process.exit(1);
  }

  /**
   * 2. HOW LONG THIS TOKEN LIVES — the claim the whole connect story rests on.
   *
   * `debug_token` reports `expires_at: 0` for a token that does not expire,
   * which is what a Full-tier app or a system-user token should show. Anything
   * around 60 days is the classic long-lived user token and means every
   * customer re-authorises six times a year.
   */
  const debug = await get("/debug_token", { input_token: token, access_token: token });
  const data = (debug.json?.["data"] ?? {}) as Record<string, unknown>;
  const expiresAt = Number(data["expires_at"] ?? -1);
  const type = String(data["type"] ?? "unknown");
  const scopes = Array.isArray(data["scopes"]) ? (data["scopes"] as string[]) : [];
  const lifetime =
    expiresAt === 0
      ? "NEVER EXPIRES — this is the durable path"
      : expiresAt > 0
        ? `expires ${new Date(expiresAt * 1000).toISOString()} (${Math.round((expiresAt * 1000 - Date.now()) / 86_400_000)} days)`
        : "no expiry reported";
  record(debug.ok, "token lifetime and type", `type=${type} ${lifetime}; scopes=${scopes.join(",") || "none reported"}`);
  record(scopes.includes("ads_read"), "ads_read is granted", scopes.includes("ads_read") ? "present" : `missing — got ${scopes.join(",")}`);

  // 3. Which ad accounts this token reaches (the picker's own call).
  const accounts = await get("/me/adaccounts", {
    access_token: token,
    fields: "account_id,name,currency,timezone_name,account_status",
    limit: "5",
  });
  const list = Array.isArray(accounts.json?.["data"]) ? (accounts.json!["data"] as Record<string, unknown>[]) : [];
  record(accounts.ok, "the ad account picker returns accounts", accounts.ok ? `${list.length} reachable` : accounts.text.slice(0, 200));

  const account = process.env.META_AD_ACCOUNT ?? (list[0] ? `act_${list[0]["account_id"]}` : null);
  if (!account) {
    console.error("\nNo ad account to probe. Set META_AD_ACCOUNT=act_… or grant this token access to one.");
    process.exit(1);
  }
  const zone = String(list.find((a) => `act_${a["account_id"]}` === account)?.["timezone_name"] ?? "unknown");
  console.log(`\nprobing ${account} (timezone ${zone})\n`);

  /**
   * 4. THE INSIGHTS CALL THE CONNECTOR ACTUALLY MAKES, including the two
   *    parameters most likely to be silently ignored.
   */
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const insights = await get(`/${account}/insights`, {
    access_token: token,
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,impressions,clicks,account_currency,actions,action_values",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    use_account_attribution_setting: "true",
    limit: "50",
  });
  const rows = Array.isArray(insights.json?.["data"]) ? (insights.json!["data"] as Record<string, unknown>[]) : [];
  record(insights.ok, "insights returns rows for the last 7 days", insights.ok ? `${rows.length} rows` : insights.text.slice(0, 300));

  if (rows.length > 0) {
    const dates = new Set(rows.map((r) => String(r["date_start"])));
    // One row per day is what `time_increment=1` buys; a single date across
    // every row means Meta collapsed the range and every number would land on
    // one day.
    record(dates.size > 1 || rows.length === 1, "time_increment=1 produced daily rows", `${dates.size} distinct dates across ${rows.length} rows`);
    const sample = rows[0];
    for (const field of ["date_start", "spend", "impressions", "clicks"]) {
      record(sample[field] !== undefined, `insights carries ${field}`, `= ${JSON.stringify(sample[field])}`);
    }
    record(
      typeof sample["spend"] === "string",
      "metrics arrive as STRINGS, as the connector assumes",
      `spend is a ${typeof sample["spend"]}`,
    );
  } else {
    console.log("   (no spend in the last 7 days — field shape unchecked; re-run against an active account)");
  }

  /**
   * 5. THE ACCESS TIER AND THE THROTTLE, read off the header rather than
   *    guessed. `development_access` means 60 points per 300s for the WHOLE
   *    fleet; `standard_access` means 9,000 and the catalog's fleetLimits
   *    should be raised to match.
   */
  const throttle = insights.headers.get("x-fb-ads-insights-throttle");
  const usage = insights.headers.get("x-ad-account-usage");
  record(!!throttle, "the throttle header is present", throttle ?? "absent — cannot read the access tier");
  if (throttle) {
    try {
      const t = JSON.parse(throttle) as Record<string, unknown>;
      const tier = String(t["ads_api_access_tier"] ?? "unknown");
      record(
        tier === "standard_access",
        `access tier is ${tier}`,
        tier === "standard_access"
          ? "9,000 points/300s — raise catalog fleetLimits to 1800/min"
          : "60 points/300s across every customer. Apply for Full Access (500+ calls in 15 days, <15% errors).",
      );
      console.log(`        app util ${t["app_id_util_pct"]}%, account util ${t["acc_id_util_pct"]}%`);
    } catch {
      record(false, "throttle header parses", throttle);
    }
  }
  if (usage) console.log(`        x-ad-account-usage: ${usage}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.label}: ${f.note}`);
  } else {
    console.log("Record the date in the catalog entry's `verified.live`.");
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
