/**
 * Live prober for Aircall. Prints measurements; asserts only comparisons
 * between its own responses. Run: AIRCALL_API_KEY=api_id:api_token pnpm tsx scripts/verify-aircall.ts
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = "https://api.aircall.io/v1"; // keep in step with src/connectors/aircall.ts
const probe = createProbe("Aircall");
const pair = requireEnv("AIRCALL_API_KEY", "api_id:api_token from Company settings → Integrations & API");
const headers = { authorization: `Basic ${Buffer.from(pair).toString("base64")}` };
const count = (x: unknown) => (Array.isArray((x as { calls?: unknown[] })?.calls) ? (x as { calls: unknown[] }).calls.length : -1);

async function main() {
  probe.head("SECTION 1 — /v1/calls answers, and a call's timestamps");
  const page = await probe.section("list", () => attemptJson(probe, `${API}/calls?per_page=5&order=desc`, { headers }));
  if (page) {
    probe.check("calls list responds 2xx", page.ok, `HTTP ${page.status}`);
    if (page.ok) {
      const body = page.body as { meta?: Record<string, unknown>; calls?: Array<Record<string, unknown>> };
      probe.note("meta", JSON.stringify(body.meta ?? null));
      const c = body.calls?.[0];
      probe.note("first call: started_at / answered_at / ended_at / duration", c ? `${c["started_at"]} / ${c["answered_at"]} / ${c["ended_at"]} / ${c["duration"]}` : "no calls");
      if (c && typeof c["ended_at"] === "number" && typeof c["started_at"] === "number") {
        probe.check("duration equals ended_at − started_at (it includes ring time)", c["duration"] === c["ended_at"] - c["started_at"], `duration=${c["duration"]} ended−started=${c["ended_at"] - c["started_at"]}`);
      }
    }
  }

  probe.head("SECTION 2 — do from/to FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, `${API}/calls?per_page=50`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, `${API}/calls?per_page=50&from=1900000000`, { headers }));
  if (all?.ok && bounded?.ok) {
    probe.check("a far-future `from` returns zero rows (the parameter is honoured)", count(bounded.body) === 0, `unbounded=${count(all.body)} bounded=${count(bounded.body)}`);
  }

  probe.head("SECTION 3 — rate-limit headers");
  const res = await fetch(`${API}/ping`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /aircallapi|ratelimit|retry-after|signature/i.test(k)).map(([k, v]) => `${k}=${v}`).join(", ") || "none");
  probe.note("a signature header on responses", [...res.headers.keys()].some((k) => /signature/i.test(k)) ? "present" : "absent — as the docs say, verification is the registration token in the delivery body");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
