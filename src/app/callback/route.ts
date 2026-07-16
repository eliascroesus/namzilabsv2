import { handleAuth } from "@workos-inc/authkit-nextjs";

// WorkOS redirects here after authentication (must match
// NEXT_PUBLIC_WORKOS_REDIRECT_URI, e.g. https://app.namzilabs.com/callback).
export const GET = handleAuth({ returnPathname: "/admin" });
