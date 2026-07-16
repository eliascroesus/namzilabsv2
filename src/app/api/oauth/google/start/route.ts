import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { buildGoogleAuthUrl, GOOGLE_SCOPES } from "@/lib/google-oauth";

export const runtime = "nodejs";

/**
 * Begin Google OAuth for a Google-backed source. The tenant is taken from the
 * session in the callback (never from `state`); `state` only carries the
 * non-sensitive source id.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const source = new URL(req.url).searchParams.get("source") === "gcal" ? "gcal" : "gsheets";
  const state = Buffer.from(JSON.stringify({ source })).toString("base64url");
  const url = buildGoogleAuthUrl({ scopes: GOOGLE_SCOPES[source], state });
  return NextResponse.redirect(url);
}
