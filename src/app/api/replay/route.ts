import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { replayRawEvent } from "@/ingestion/pipeline";
import { getOrgContext } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions";

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
 * Replay a raw event through the pipeline (e.g. from the DLQ). Requires an
 * authenticated session; the raw event must belong to the caller's organization
 * (enforced in replayRawEvent).
 */
export async function POST(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // replayDeadLetterAction gates this same work on connect_integrations; a
  // route that skips the gate is a second door to the first door's room.
  {
    const access = await effectiveAccess(getDb(), ctx);
    if (!access.can("connect_integrations")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
    const result = await replayRawEvent(getDb(), body.rawEventId, ctx.orgId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("forbidden") ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
