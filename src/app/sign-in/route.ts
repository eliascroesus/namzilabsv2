import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";

// PKCE sign-in must run in a Route Handler (it sets the verifier cookie).
export async function GET() {
  redirect(await getSignInUrl());
}
