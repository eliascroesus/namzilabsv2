import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { replayRawEvent } from "@/ingestion/pipeline";
import { getOrgContext } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * Replay a raw event through the pipeline (e.g. from the DLQ). Requires an
 * authenticated session; the raw event must belong to the caller's organization
 * (enforced in replayRawEvent).
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { rawEventId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.rawEventId) {
    return NextResponse.json({ error: "rawEventId is required" }, { status: 400 });
  }

  try {
    const result = await replayRawEvent(getDb(), body.rawEventId, ctx.orgId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("forbidden") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
