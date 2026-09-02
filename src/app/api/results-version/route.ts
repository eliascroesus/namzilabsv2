import { NextResponse } from "next/server";
import { getReadDb } from "@/db/client";
import { resultsVersion } from "@/lib/flow/materialize";
import { resultsEtag } from "@/lib/flow/results-etag";
import { getOrgContext } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * G.4 — the dashboard's freshness poll. Authenticated, org-scoped, one cheap
 * aggregate. Clients send If-None-Match with the last ETag; an unchanged
 * version costs a 304 with no body, so a fleet of open dashboards stays
 * near-free until data actually changes (then they refetch changed tiles).
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const version = await resultsVersion(getReadDb(), ctx.orgId);
  const etag = resultsEtag(version);

  if (req.headers.get("if-none-match") === etag) {
    return new NextResponse(null, { status: 304, headers: { etag, "cache-control": "no-cache" } });
  }
  return NextResponse.json({ version }, { headers: { etag, "cache-control": "no-cache" } });
}
