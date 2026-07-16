import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * Auth is bypassed when Clerk keys are absent (local dev / Prompt 1), so the
 * engine is fully runnable without provisioning Clerk. When CLERK_SECRET_KEY is
 * set, Clerk middleware runs. Machine endpoints (webhooks, inngest, health) are
 * always excluded via the matcher below.
 */
const middleware = process.env.CLERK_SECRET_KEY ? clerkMiddleware() : () => NextResponse.next();

export default middleware;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/inngest|api/health).*)"],
};
