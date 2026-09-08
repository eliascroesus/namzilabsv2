/**
 * Live prober for Help Scout. Prints measurements; asserts only comparisons
 * between its own responses.
 *
 * Run: HELPSCOUT_API_KEY="<appId>:<appSecret>" pnpm tsx scripts/verify-helpscout.ts
 *
 * The questions it exists to answer, in order of how much they would cost to be
 * wrong about:
 *  1. Does `modifiedSince` actually FILTER? (a far-future bound must return zero)
 *  2. Is there a `modifiedAt` / `updatedAt` field after all? The connector's
 *     watermark is the max of four other timestamps precisely because the
 *     documented object has none — if one shows up here, use it instead.
 *  3. Does `sortField=modifiedAt&sortOrder=asc` hold, and what is `page.size`?
 *  4. What do the rate-limit headers say this account's per-minute limit is?
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = "https://api.helpscout.net"; // keep in step with src/connectors/helpscout.ts
const probe = createProbe("Help Scout");
const raw = requireEnv("HELPSCOUT_API_KEY", 'the app credentials as "<appId>:<appSecret>" (My Apps → Create My App)');
const split = raw.indexOf(":");
if (split < 1) {
  console.error('HELPSCOUT_API_KEY must be "<appId>:<appSecret>".');
  process.exit(2);
}
const appId = raw.slice(0, split);
const appSecret = raw.slice(split + 1);

type Conversation = Record<string, unknown>;
const conversations = (x: unknown): Conversation[] => {
  const rows = (x as { _embedded?: { conversations?: unknown[] } })?._embedded?.conversations;
  return Array.isArray(rows) ? (rows as Conversation[]) : [];
};

async function main() {
  probe.head("SECTION 1 — client-credentials token (form-encoded, per the auth doc)");
  const token = await probe.section("token", () =>
    attemptJson(probe, `${API}/v2/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: appId, client_secret: appSecret }).toString(),
    }),
  );
  if (!token?.ok) {
    probe.check("token endpoint responds 2xx", false, token ? `HTTP ${token.status}: ${String(token.body).slice(0, 160)}` : "no response");
    probe.report();
  }
  const body = token!.body as { access_token?: string; token_type?: string; expires_in?: number };
  probe.check("the response carries an access_token", Boolean(body.access_token), `token_type=${body.token_type} expires_in=${body.expires_in}`);
  if (!body.access_token) probe.report();
  const headers = { authorization: `Bearer ${body.access_token}` };

  probe.head("SECTION 2 — conversations: shape, page envelope, ordering");
  const list = await probe.section("conversations", () =>
    attemptJson(probe, `${API}/v2/conversations?status=all&sortField=modifiedAt&sortOrder=asc&page=1`, { headers }),
  );
  if (list?.ok) {
    const rows = conversations(list.body);
    const page = (list.body as { page?: Record<string, unknown> }).page;
    probe.note("page envelope", JSON.stringify(page ?? null));
    probe.note("conversations on page 1", String(rows.length));
    probe.note("first conversation's fields", rows[0] ? Object.keys(rows[0]).join(", ") : "no conversations");
    // THE decisive field question: the connector's watermark is
    // max(userUpdatedAt, customerWaitingSince.time, closedAt, createdAt)
    // because the documented object exposes no modification timestamp.
    const hasModified = rows.some((r) => "modifiedAt" in r || "updatedAt" in r);
    probe.check("the conversation object still has NO modifiedAt/updatedAt field", !hasModified, hasModified ? "one appeared — switch the watermark to it" : "confirmed");
    probe.note(
      "timestamps on the first conversation",
      rows[0]
        ? `createdAt=${rows[0]["createdAt"]} closedAt=${rows[0]["closedAt"]} userUpdatedAt=${rows[0]["userUpdatedAt"]} customerWaitingSince=${JSON.stringify(rows[0]["customerWaitingSince"] ?? null)}`
        : "n/a",
    );
    probe.note("statuses on page 1 (status=all must not be only 'active')", [...new Set(rows.map((r) => String(r["status"])))].join(", ") || "none");
  }

  probe.head("SECTION 3 — does modifiedSince FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/v2/conversations?status=all&page=1`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/v2/conversations?status=all&page=1&modifiedSince=2030-01-01T00:00:00Z`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check(
      "a far-future modifiedSince returns zero rows (the parameter is honoured)",
      conversations(bounded.body).length === 0,
      `unbounded=${conversations(all.body).length} bounded=${conversations(bounded.body).length}`,
    );
  }
  // The watermark can only be trusted while every returned row's max timestamp
  // is at or after the bound the request carried.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const window = await probe.section("30-day window", () =>
    attemptJson(probe, `${API}/v2/conversations?status=all&sortField=modifiedAt&sortOrder=asc&page=1&modifiedSince=${encodeURIComponent(since)}`, { headers }),
  );
  if (window?.ok) {
    const rows = conversations(window.body);
    const maxOf = (r: Conversation): number => {
      const waiting = r["customerWaitingSince"];
      const values = [r["createdAt"], r["closedAt"], r["userUpdatedAt"], typeof waiting === "string" ? waiting : (waiting as { time?: string })?.time];
      return Math.max(...values.map((v) => (typeof v === "string" ? Date.parse(v) : NaN)).filter((n) => Number.isFinite(n)), -Infinity);
    };
    const sinceMs = Date.parse(since);
    const behind = rows.filter((r) => maxOf(r) < sinceMs);
    probe.check(
      "every row's newest exposed timestamp is at or after the modifiedSince bound",
      behind.length === 0,
      `rows=${rows.length} behind=${behind.length}${behind[0] ? ` (e.g. id ${behind[0]["id"]})` : ""} — any behind means the true modifiedAt is invisible and the mark must keep lagging`,
    );
  }

  probe.head("SECTION 4 — threads of the first conversation");
  const first = conversations(list?.ok ? list.body : null)[0] ?? conversations(all?.ok ? all.body : null)[0];
  if (!first?.["id"]) probe.skip("threads", "no conversation to read");
  else {
    const threads = await probe.section("threads", () => attemptJson(probe, `${API}/v2/conversations/${first["id"]}/threads`, { headers }));
    if (threads?.ok) {
      const rows = (threads.body as { _embedded?: { threads?: Array<Record<string, unknown>> } })._embedded?.threads ?? [];
      probe.note("thread page envelope", JSON.stringify((threads.body as { page?: unknown }).page ?? null));
      probe.note("thread types / states", rows.map((t) => `${t["type"]}/${t["state"]}`).join(", ") || "none");
      probe.note("thread createdAt order", rows.map((t) => String(t["createdAt"])).join(", ") || "none");
      probe.note(
        "does the oldest thread share the conversation's createdAt? (the opening-message rule)",
        rows.length ? `conversation=${first["createdAt"]} oldest thread=${rows.map((t) => String(t["createdAt"])).sort()[0]}` : "n/a",
      );
    }
  }

  probe.head("SECTION 5 — rate-limit headers");
  const res = await fetch(`${API}/v2/conversations?status=all&page=1`, { headers });
  probe.bump();
  const seen = [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k));
  probe.note("headers", seen.map(([k, v]) => `${k}=${v}`).join(", ") || "none");
  // The catalog declares 200/min (the Standard plan figure from
  // docs.helpscout.com/article/1140-mailbox-api); this account may be higher.
  probe.note("declared vs observed limit", `declared=200/min observed=${seen.find(([k]) => /limit-minute/i.test(k))?.[1] ?? "unstated"}`);
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
