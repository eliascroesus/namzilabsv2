import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { replayRawEvent } from "@/ingestion/pipeline";

export const runtime = "nodejs";

/**
 * Replay a raw event through the pipeline (e.g. from the DLQ). Protected by a
 * shared internal secret when INTERNAL_API_SECRET is set.
 */
export async function POST(req: Request) {
  const required = process.env.INTERNAL_API_SECRET;
  if (required && req.headers.get("x-internal-secret") !== required) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
    const result = await replayRawEvent(getDb(), body.rawEventId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
