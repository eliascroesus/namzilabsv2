/**
 * Live probe for the TikTok Ads connector.
 *
 * THIS SCRIPT CARRIES MORE WEIGHT THAN THE OTHER PROBERS, because TikTok's
 * documentation portal renders client-side and cannot be read by any fetcher.
 * Every figure in the catalog entry comes from TikTok's own SDK reference on
 * GitHub rather than from an API reference page, which is weaker provenance than
 * anything else in this codebase. Three claims in particular are unverified
 * until this runs:
 *
 *   1. THE TOKEN DOES NOT EXPIRE. `OAUTH_PROVIDERS.tiktok` declares
 *      `refresh: "none"` on the strength of secondary sources. If the token
 *      response carries an `expires_in`, that declaration is WRONG and every
 *      TikTok connection will die silently when it lapses.
 *   2. Failures really do arrive as HTTP 200 with a non-zero `code`.
 *   3. The report endpoint accepts the exact parameter set the connector sends.
 *
 *   TIKTOK_ADS_TOKEN=… TIKTOK_APP_ID=… TIKTOK_APP_SECRET=… pnpm tsx scripts/verify-tiktok-ads.ts
 *
 * Read-only: it issues GETs and writes nothing.
 */
import { TIKTOK_API_VERSION } from "@/connectors/tiktok-ads";

const API = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;

type Check = { ok: boolean; label: string; note: string };
const results: Check[] = [];

function record(ok: boolean, label: string, note: string) {
  results.push({ ok, label, note });
  console.log(`${ok ? " OK  " : "FAIL "} ${label}\n        ${note}`);
}

async function call(token: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { headers: { "Access-Token": token } });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* keep the raw text */
  }
  return { httpStatus: res.status, code: Number(json?.["code"] ?? -1), json, text };
}

async function main() {
  const token = process.env.TIKTOK_ADS_TOKEN ?? process.env.TIKTOK_ADS_API_KEY;
  const appId = process.env.TIKTOK_APP_ID;
  const secret = process.env.TIKTOK_APP_SECRET;
  if (!token || !appId || !secret) {
    console.error("Set TIKTOK_ADS_TOKEN, TIKTOK_APP_ID and TIKTOK_APP_SECRET.");
    console.error("The app lives at business-api.tiktok.com/portal — My Apps; the token comes from an advertiser authorisation.");
    process.exit(2);
  }
  console.log(`connector pins: ${TIKTOK_API_VERSION}\n`);

  // 1. The authorised advertisers — the picker's own call, and the cheapest
  //    proof the token works at all.
  const granted = await call(token, "/oauth2/advertiser/get/", { app_id: appId, secret });
  record(
    granted.code === 0,
    "the token is live and names its advertisers",
    granted.code === 0
      ? `${(((granted.json?.["data"] as Record<string, unknown>)?.["list"] as unknown[]) ?? []).length} advertiser(s)`
      : `code ${granted.code}: ${granted.text.slice(0, 200)}`,
  );
  if (granted.code !== 0) {
    console.error("\nStopping: without a working token nothing below would mean anything.");
    process.exit(1);
  }

  /**
   * 2. FAILURES ARRIVE AS HTTP 200. Deliberately malformed, so the answer is a
   *    failure we can look at. If this ever returns a real 4xx, `expectOk` is
   *    no longer the only thing standing between a throttle and a silently
   *    empty dashboard — and the connector's central assumption has changed.
   */
  const bad = await call(token, "/advertiser/info/", { advertiser_ids: "not-json" });
  record(
    bad.httpStatus === 200 && bad.code !== 0,
    "a refused request still answers HTTP 200",
    `http ${bad.httpStatus}, code ${bad.code} — ${String(bad.json?.["message"] ?? "").slice(0, 120)}`,
  );

  const advertisers = ((granted.json?.["data"] as Record<string, unknown>)?.["list"] ?? []) as Record<string, unknown>[];
  const advertiserId = process.env.TIKTOK_ADVERTISER_ID ?? String(advertisers[0]?.["advertiser_id"] ?? "");
  if (!advertiserId) {
    console.error("\nNo advertiser account authorised for this token.");
    process.exit(1);
  }

  // 3. Currency and timezone — what dates every row correctly.
  const info = await call(token, "/advertiser/info/", { advertiser_ids: JSON.stringify([advertiserId]) });
  const advertiser = (((info.json?.["data"] as Record<string, unknown>)?.["list"] as Record<string, unknown>[]) ?? [])[0] ?? {};
  record(info.code === 0, "advertiser info carries currency and timezone", `currency=${advertiser["currency"]} timezone=${advertiser["timezone"]}`);
  record(
    typeof advertiser["timezone"] === "string" && String(advertiser["timezone"]).includes("/"),
    "the timezone is an IANA zone name the connector can resolve",
    String(advertiser["timezone"] ?? "absent"),
  );

  console.log(`\nprobing advertiser ${advertiserId}\n`);

  // 4. The exact report call the connector makes.
  const start = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const report = await call(token, "/report/integrated/get/", {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    service_type: "AUCTION",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
    metrics: JSON.stringify(["spend", "impressions", "clicks", "conversion", "campaign_name"]),
    start_date: start,
    end_date: end,
    page: "1",
    page_size: "100",
  });
  record(report.code === 0, "the integrated report accepts the connector's parameters", report.code === 0 ? "accepted" : `code ${report.code}: ${report.text.slice(0, 300)}`);

  const rows = (((report.json?.["data"] as Record<string, unknown>)?.["list"] as Record<string, unknown>[]) ?? []);
  if (rows.length > 0) {
    const dims = (rows[0]["dimensions"] ?? {}) as Record<string, unknown>;
    const mets = (rows[0]["metrics"] ?? {}) as Record<string, unknown>;
    const day = String(dims["stat_time_day"] ?? "");
    record(
      /^\d{4}-\d{2}-\d{2}[ T]/.test(day),
      "stat_time_day is a space-separated timestamp, as the connector assumes",
      JSON.stringify(day),
    );
    record("campaign_name" in mets, "campaign_name comes back under metrics, not dimensions", Object.keys(mets).join(","));
    record(typeof mets["spend"] === "string", "metrics arrive as STRINGS", `spend is a ${typeof mets["spend"]}`);
  } else {
    console.log("   (no spend in the last 3 days — row shape unchecked; re-run against an active advertiser)");
  }

  /**
   * 5. THE CLAIM MOST WORTH DOUBTING. Nothing here can mint a token, so this
   *    reports what the CURRENT one looks like and tells the reader what to
   *    watch for at the next authorisation.
   */
  console.log(
    "\nTOKEN LIFETIME — the one thing this script cannot settle on its own.\n" +
      "  `OAUTH_PROVIDERS.tiktok` declares refresh: \"none\" on secondary sources alone.\n" +
      "  At the NEXT advertiser authorisation, print the /oauth2/access_token/ response.\n" +
      "  If it carries `expires_in` or a `refresh_token`, that declaration is wrong:\n" +
      "  switch the provider to a real refresh and re-run this.",
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
