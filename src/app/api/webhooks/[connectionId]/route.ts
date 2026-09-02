import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { storeRawEvent } from "@/ingestion/raw-store";
import { deadLetterRawEvent } from "@/ingestion/pipeline";
import { inngest } from "@/inngest/client";
import { headersToObject } from "@/lib/http";
import { decrypt, getEncryptionKey } from "@/lib/crypto";
import { promoteToBaseCadence } from "@/lib/sync/cadence";
import { recordRejectedDelivery } from "@/lib/webhooks/rejections";

export const runtime = "nodejs";

/**
 * Serverless duration budget.
 *
 * Vercel's default is 10s on Hobby and 15s on Pro. Neither is survivable for
 * this route: a sync issues a provider call (bounded at PROVIDER_CALL_BUDGET_MS
 * in src/lib/http-client.ts) plus ten or more Neon round trips, each of which is
 * its own HTTPS request on the http driver. Under the default the container is
 * killed mid-run — Inngest sees a failure, and the test_runs row is stranded at
 * `running` because it is stamped before the work starts.
 *
 * 60 is the Hobby ceiling and is valid on Pro too; raise to 300 on Pro if a
 * first sync ever needs it. Whatever this is, it MUST stay above the HTTP
 * budget in src/lib/http-client.ts — tests/http-client.test.ts pins that.
 */
export const maxDuration = 60;

/**
 * The most bytes one delivery may carry.
 *
 * Vercel already rejects bodies over 4.5MB at the platform edge, so this is
 * not the outer wall — it is the inner one, protecting what a payload becomes
 * AFTER acceptance: a `raw_events.payload` jsonb row (stored verbatim,
 * forever until retention), a `normalizeDatesDeep` walk, and an upsert
 * statement. No provider here sends events beyond a few kilobytes; a
 * megabyte is two orders of magnitude of headroom above the real traffic and
 * three below the platform cap, so nothing legitimate is turned away.
 *
 * Checked on the BYTES READ, not the Content-Length header alone — a header
 * is a claim, and chunked encodings may not send one at all.
 */
const MAX_BODY_BYTES = 1_000_000;

/**
 * Universal inbound webhook receiver. Implements the fast-ack pattern:
 *   1. verify signature   2. persist raw payload   3. return 202 immediately
 *   4. hand off to the durable queue for out-of-band processing.
 * No slow work happens inside the request.
 */
export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  const db = getDb();

  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) return NextResponse.json({ error: "unknown connection" }, { status: 404 });
  if (conn.status === "disabled") return NextResponse.json({ error: "connection disabled" }, { status: 403 });

  const connector = getConnector(conn.source);
  if (!connector) return NextResponse.json({ error: "no connector for source" }, { status: 400 });

  // Cheap first gate: a declared length over the cap is refused before the
  // body is read at all. The read-side check below is the one that holds.
  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    await recordRejectedDelivery(db, conn, "oversized-body");
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  // Read the exact raw bytes BEFORE parsing — HMAC must be computed over these.
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    await recordRejectedDelivery(db, conn, "oversized-body");
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  const headers = headersToObject(req.headers);

  // "No secret configured" and "a secret exists but we cannot read it" are
  // different states, and collapsing them was the whole exposure: a decrypt
  // failure (rotated ENCRYPTION_KEY, corrupted ciphertext) silently produced
  // `secret = null`, which the fail-open connectors read as "unauthenticated is
  // fine". Rows written that way land at generation 0 with a null stream_hash,
  // which no SWEEP can retire — every sweep's soft-delete is generation-guarded
  // or stream-hash-scoped — so nothing automatic will ever remove them.
  //
  // A configured-but-unreadable secret now fails CLOSED for every connector,
  // including the deliberately-open catch-hook: an endpoint the operator chose
  // to protect must not swing open because a key rotation went wrong.
  let secret: string | null = null;
  if (conn.signingSecretEncrypted) {
    try {
      secret = decrypt(conn.signingSecretEncrypted, getEncryptionKey());
    } catch {
      console.error(`[webhook] signing secret unreadable for connection ${conn.id} — rejecting until it is re-set`);
      await recordRejectedDelivery(db, conn, "unreadable-secret");
      return NextResponse.json({ error: "signing secret unreadable" }, { status: 401 });
    }
  }

  const verified = connector.verifySignature({ rawBody, headers, secret });
  if (!verified) {
    /**
     * THIS BRANCH WAS SILENT, and it is the likelier of the two.
     *
     * A connection can refuse every delivery for weeks with no record anywhere:
     * nothing reaches `raw_events` (correct — the payload failed authentication
     * and must never enter the replay source of truth), nothing reached
     * `delivery_log`, and this path did not even log. The only evidence was the
     * platform request log.
     *
     * Note what a 401 does and does not cost, because it differs by source. For
     * a stream-scoped connector the inbound hook is a DOORBELL — the bail below
     * only asks for a sweep, and the poll is the sole ingest path — so a refused
     * delivery loses nothing at all. For the custom webhook there is no poll, so
     * a refused delivery is gone. `google-calendar` is the one that can never
     * succeed: its `verifySignature` returns false unconditionally, so every
     * POST to a gcal connection 401s whatever is configured.
     */
    console.warn(
      `[webhook] invalid signature for connection ${conn.id} (${conn.source}) — ` +
        `secret ${secret ? "configured" : "absent"}; rejected without storing the payload`,
    );
    await recordRejectedDelivery(db, conn, "invalid-signature");
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  /**
   * 4b — a stream-scoped source's webhook is a DOORBELL, not a delivery.
   *
   * It used to be 202-ignored before verification even ran. The reason was
   * sound: a connection-level payload carries no stream identity, so there is
   * nothing to attribute the records to. What was wrong was throwing the signal
   * away with the payload — an authenticated Calendly POST proves something on
   * this connection changed, which is worth acting on even when its contents
   * are not.
   *
   * So: sweep, do not ingest. The poll reads with correct stream attribution;
   * this only decides WHEN.
   *
   * Ingesting would be actively harmful rather than merely useless. Records
   * written from here land at generation 0 with a null `stream_hash`, and every
   * one of the seven soft-delete sites skips that class by construction — so
   * they would be permanent, unreachable duplicates of rows the poll writes
   * properly. That is why nothing is stored and `ingest/raw.received` is not
   * sent: the only safe thing to do with this payload is to notice it arrived.
   */
  if (isStreamScoped(conn.source)) {
    await promoteToBaseCadence(db, conn.id).catch(() => {});
    // sync/connection.requested, NOT ingest/reconcile.requested — and the
    // difference is whether the doorbell can be SILENTLY DROPPED. The
    // reconcile worker is singleton-skip (correct for a cron that
    // re-dispatches every tick), so a webhook landing while this
    // connection's sweep was mid-flight used to vanish: the one delivery
    // the user could see happen did nothing, up to a full sweep interval.
    // That also violated the sender rule client.ts documents — user-initiated
    // work rides the sync queue, which QUEUES per connection and always
    // runs, under the connection lease. An incremental sync from the stored
    // cursors is exactly one page per stream when little changed.
    await inngest.send({
      name: "sync/connection.requested",
      data: { connectionId: conn.id, mode: "incremental" },
    });
    return NextResponse.json({ ok: true, swept: "connection" }, { status: 202 });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = { _raw: rawBody };
  }

  const raw = await storeRawEvent(db, {
    orgId: conn.orgId,
    connectionId: conn.id,
    source: conn.source,
    headers,
    payload,
    // What actually happened, not a constant. This was hardcoded `true`, so the
    // provenance trail asserted every stored payload had been verified —
    // including the ones accepted because no secret was configured at all.
    signatureValid: secret != null,
  });

  // orgId rides along for the processor's per-tenant concurrency cap (C.3).
  try {
    await inngest.send({ name: "ingest/raw.received", data: { rawEventId: raw.id, orgId: conn.orgId } });
  } catch (err) {
    /**
     * C.1: an Inngest outage must not orphan the raw row. This used to be
     * un-guarded — the send threw straight out of the handler, Vercel turned
     * that into a 500, and the payload above was ALREADY committed to
     * `raw_events` with nothing ever queued to process it. Not even the DLQ
     * page could see it, because dead-lettering only ever ran from inside the
     * processor this event never reached: a stored row, invisible and stuck.
     *
     * Fail the same way a processing failure fails, so the one DLQ surface
     * covers both: park it (attempts: 0 — this never got as far as an
     * attempt) and tell the caller it was accepted but not queued. No inline
     * processing here — a synchronous fallback is exactly the slow path the
     * fast-ack pattern above exists to avoid.
     */
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[webhook] inngest.send failed for raw event ${raw.id} (connection ${conn.id}): ${message}`);
    await deadLetterRawEvent(db, raw.id, 0, `enqueue failed: ${message}`);
    return NextResponse.json({ ok: true, rawEventId: raw.id, queued: false }, { status: 202 });
  }

  // H.2: inbound data proves this connection is live — cancel any idle backoff
  // so the reconcile backstop returns to base cadence immediately.
  await promoteToBaseCadence(db, conn.id).catch(() => {});

  return NextResponse.json({ ok: true, rawEventId: raw.id }, { status: 202 });
}
