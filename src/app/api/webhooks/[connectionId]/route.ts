import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { getConnector } from "@/connectors/registry";
import { isStreamScoped } from "@/connectors/catalog";
import { storeRawEvent } from "@/ingestion/raw-store";
import { inngest } from "@/inngest/client";
import { headersToObject } from "@/lib/http";
import { decrypt, getEncryptionKey } from "@/lib/crypto";
import { promoteToBaseCadence } from "@/lib/sync/cadence";

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

  // Stream-scoped sources (Calendly, Sheets…) are poll-driven: a connection-level
  // webhook can't be attributed to a specific flow's stream, so it's acked and ignored.
  // (Real-time per-stream webhooks — with the stream in the URL — are a later addition.)
  if (isStreamScoped(conn.source)) return NextResponse.json({ ok: true, ignored: "stream-scoped" }, { status: 202 });

  // Read the exact raw bytes BEFORE parsing — HMAC must be computed over these.
  const rawBody = await req.text();
  const headers = headersToObject(req.headers);

  // "No secret configured" and "a secret exists but we cannot read it" are
  // different states, and collapsing them was the whole exposure: a decrypt
  // failure (rotated ENCRYPTION_KEY, corrupted ciphertext) silently produced
  // `secret = null`, which the fail-open connectors read as "unauthenticated is
  // fine". Rows written that way land at generation 0 with a null stream_hash,
  // which every soft-delete site skips by construction — so they are permanent.
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
      return NextResponse.json({ error: "signing secret unreadable" }, { status: 401 });
    }
  }

  const verified = connector.verifySignature({ rawBody, headers, secret });
  if (!verified) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
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
  await inngest.send({ name: "ingest/raw.received", data: { rawEventId: raw.id, orgId: conn.orgId } });

  // H.2: inbound data proves this connection is live — cancel any idle backoff
  // so the reconcile backstop returns to base cadence immediately.
  await promoteToBaseCadence(db, conn.id).catch(() => {});

  return NextResponse.json({ ok: true, rawEventId: raw.id }, { status: 202 });
}
