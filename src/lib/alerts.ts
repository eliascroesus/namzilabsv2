/**
 * Ops alerts — the missing last mile of every "something stopped" signal.
 *
 * The nightly invariant scan was built to answer "is work still happening?"
 * and returns `anyFindings` explicitly so "a caller can alert without
 * re-deriving it" (its own words). The caller never alerted: findings died in
 * one `console.warn` at 03:17 that somebody had to go looking for. This is
 * the alert.
 *
 * One POST to Resend's REST API via plain `fetch` — deliberately:
 *  - NO SDK: one endpoint does not justify a dependency.
 *  - NOT through src/lib/http-client.ts's `fetchJson`: its retry/backoff and
 *    the usage ledger exist for PROVIDER calls; an ops alert must never
 *    inherit provider backoff semantics or show up in provider accounting.
 *  - FAIL-SOFT, the recordFields posture (src/ingestion/pipeline.ts): every
 *    failure is caught and logged, never thrown — an alert about a scan must
 *    not be able to fail the scan it reports on.
 *  - Missing env (`RESEND_API_KEY`, `ALERT_EMAIL`, `ALERT_FROM`) → silently
 *    `{sent:false}`: dev and CI never send, and never break.
 *
 * No dedupe/throttle, deliberately: both call sites live inside one nightly
 * cron, so the natural ceiling is two emails a day — and identical findings
 * on consecutive nights SHOULD re-alert; an unresolved finding aging is the
 * signal. If a future caller sits on a hot path, the throttle belongs here
 * (a per-subject-hash sent-at), not at call sites.
 */
export async function sendOpsAlert(subject: string, body: string): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  const from = process.env.ALERT_FROM;
  if (!apiKey || !to || !from) return { sent: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to, subject, text: body }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[ops-alert-failed] resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.error(`[ops-alert-failed] ${e instanceof Error ? e.message : String(e)}`);
    return { sent: false };
  }
}
