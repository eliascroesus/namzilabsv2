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

export const runtime = "nodejs";

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

  let secret: string | null = null;
  if (conn.signingSecretEncrypted) {
    try {
      secret = decrypt(conn.signingSecretEncrypted, getEncryptionKey());
    } catch {
      secret = null;
    }
  }

  if (!connector.verifySignature({ rawBody, headers, secret })) {
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
    signatureValid: true,
  });

  await inngest.send({ name: "ingest/raw.received", data: { rawEventId: raw.id } });

  return NextResponse.json({ ok: true, rawEventId: raw.id }, { status: 202 });
}
