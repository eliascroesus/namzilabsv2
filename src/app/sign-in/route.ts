import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/app/(auth)/next-path";

/**
 * KEPT, AND NOW A REDIRECT — `/login` is where the form lives.
 *
 * This used to bounce to WorkOS's hosted page. The form is ours and on our own
 * domain now, but this path is in the marketing nav, in `/auth-error`, in
 * invite emails already sent, and in whatever anybody has bookmarked. Deleting
 * it to save a file would break all of those.
 *
 * `?next=` rides along so a deep link that came through here still lands where
 * it was going — run through `safeNext` first, because it arrives from the
 * browser and an unchecked value here is an open redirect.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  redirect(next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
}
