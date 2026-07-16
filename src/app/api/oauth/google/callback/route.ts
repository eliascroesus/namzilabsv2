import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth";
import { exchangeGoogleCode } from "@/lib/google-oauth";
import { createConnection } from "@/lib/connections";

export const runtime = "nodejs";

/**
 * Google OAuth callback. The organization is derived ONLY from the authenticated
 * session — the browser cannot influence which org the connection lands in.
 */
export async function GET(req: Request) {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.redirect(new URL("/", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/integrations?error=oauth_denied", req.url));

  const source = decodeSource(url.searchParams.get("state"));

  try {
    const tokens = await exchangeGoogleCode(code);
    const conn = await createConnection({
      orgId: ctx.orgId,
      source,
      name: source === "gcal" ? "Google Calendar" : "Google Sheets",
      authType: "oauth2",
      credentials: tokens as unknown as Record<string, unknown>,
      config: {},
    });
    return NextResponse.redirect(new URL(`/connections/${conn.id}`, req.url));
  } catch {
    return NextResponse.redirect(new URL("/integrations?error=oauth_exchange", req.url));
  }
}

function decodeSource(state: string | null): "gsheets" | "gcal" {
  try {
    const parsed = JSON.parse(Buffer.from(state ?? "", "base64url").toString("utf8"));
    return parsed?.source === "gcal" ? "gcal" : "gsheets";
  } catch {
    return "gsheets";
  }
}
