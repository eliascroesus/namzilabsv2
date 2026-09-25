import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getOrgContext } from "@/lib/auth";
import { CODE_COOKIE, CODE_COOKIE_DAYS } from "@/lib/billing/onboard";
import { applyPlan } from "@/lib/billing/pauses";
import { normaliseCode, redeemCode } from "@/lib/billing/state";

/**
 * AN ACCESS CODE BY LINK — `namzilabs.co/p/STUDENTS30`, what the owner sends
 * to a class of students or a list of clients.
 *
 * Someone already in a workspace has it redeemed on the spot. Anyone else keeps
 * the code in a cookie and goes to sign up; creating their workspace redeems it
 * (`afterWorkspaceCreated`). A malformed code goes home rather than to an error.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }): Promise<Response> {
  const { code } = await ctx.params;
  const normal = normaliseCode(decodeURIComponent(code));
  if (!normal) return NextResponse.redirect(new URL("/", req.url));

  const org = await getOrgContext();
  if (org) {
    let dest = "/dashboard/settings/billing?code_error=unknown";
    try {
      const r = await redeemCode(getDb(), { orgId: org.orgId, code: normal });
      if (r.ok) await applyPlan(getDb(), org.orgId).catch(() => {});
      dest = r.ok ? "/dashboard/settings/billing?code=ok" : `/dashboard/settings/billing?code_error=${r.reason}`;
    } catch (e) {
      console.error("[billing] code link redemption failed", e);
    }
    return NextResponse.redirect(new URL(dest, req.url));
  }

  const res = NextResponse.redirect(new URL("/signup", req.url));
  res.cookies.set(CODE_COOKIE, normal, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CODE_COOKIE_DAYS * 24 * 60 * 60,
  });
  return res;
}
