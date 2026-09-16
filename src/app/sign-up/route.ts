import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/app/(auth)/next-path";

/**
 * KEPT, AND NOW A REDIRECT — `/signup` is where the form lives. See
 * `sign-in/route.ts` for why both of these still exist.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  redirect(next === "/dashboard" ? "/signup" : `/signup?next=${encodeURIComponent(next)}`);
}
