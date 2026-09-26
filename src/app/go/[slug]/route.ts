import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { SOURCE_COOKIE, SOURCE_COOKIE_DAYS, destinationFor, isBot, linkBySlug, recordClick, sourceCookieValue } from "@/lib/growth/links";

/**
 * `namzilabs.co/go/<slug>` — an owner's tracking link.
 *
 * Counts the click (not a link-preview bot's, not a HEAD), remembers the link
 * for 30 days in `nz_src`, and sends the visitor on with `utm_*` added. An
 * unknown or archived link goes home. Nothing that fails here may stop the
 * redirect: a visitor who clicked an ad must land somewhere either way.
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  let link = null;
  try {
    link = await linkBySlug(getDb(), decodeURIComponent(slug));
  } catch (e) {
    console.error("[growth] link lookup failed", e);
  }
  if (!link) return NextResponse.redirect(new URL("/", req.url));

  const res = NextResponse.redirect(new URL(destinationFor(link), req.url));
  if (req.method === "HEAD" || isBot(req.headers.get("user-agent"))) return res;

  const now = new Date();
  try {
    await recordClick(getDb(), link.id, now);
  } catch (e) {
    console.error("[growth] click not recorded", e);
  }
  res.cookies.set(SOURCE_COOKIE, sourceCookieValue(link.id, now), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SOURCE_COOKIE_DAYS * 24 * 60 * 60,
  });
  return res;
}
