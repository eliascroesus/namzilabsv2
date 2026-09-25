import { fileURLToPath } from "node:url";
import { scanAppIcons } from "./scripts/lib/app-icons.mjs";

/**
 * SECURITY HEADERS — the audit's one substantive finding, and it was that the
 * app sent none at all.
 *
 * No CSP, no HSTS, no framing policy, no `Referrer-Policy`, no `nosniff`. Every
 * other layer of this product's security held up under the audit — tenant
 * isolation is walled at every request-facing query, every server action is
 * gated, credentials are AES-256-GCM with a fresh nonce, the webhook route
 * fails closed on an unreadable secret, and the MCP path verifies membership
 * rather than trusting a token's org claim. This was the gap, and it is the
 * cheapest one in the file to close.
 *
 * WHY IT MATTERED MORE THIS WEEK. The product just grew two irreversible
 * controls — delete this workspace, delete this account — behind a typed
 * confirmation. Without a framing policy those can be iframed and overlaid:
 * the classic clickjack, against the two acts in the product that cannot be
 * undone. That alone justified the change.
 *
 * AND `Referrer-Policy` IS NOT COSMETIC HERE. A connection's webhook URL is
 * `/api/webhooks/<uuid>`, and for a source with no signing secret that UUID is
 * the whole capability — knowing it is enough to post fabricated events into
 * somebody's metrics. The same UUID appears in the address bar at
 * `/connections/<uuid>`, and with no policy set, every outbound link from that
 * page hands the full URL to a third party in the `Referer`.
 *
 * WHAT IS DELIBERATELY WEAK, so nobody reads this as stronger than it is:
 * `script-src` carries `'unsafe-inline'`. Next's App Router emits inline
 * bootstrap and hydration scripts, and the honest ways to drop it are a nonce
 * threaded through every response or a hash allowlist regenerated per build.
 * Neither is a config change, so this is not claimed. What the directive still
 * buys is real: no script from another ORIGIN can execute, which is the half
 * that turns a reflected-XSS into a data-exfiltration channel. The other
 * directives are not weakened.
 */
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  // Nothing in this product is a plugin, and `object-src` is the directive an
  // injected `<embed>` would otherwise use.
  "object-src 'none'",
  /**
   * THE CLICKJACKING FIX. `X-Frame-Options: DENY` below says the same thing to
   * older browsers; `frame-ancestors` is the one modern engines honour, and it
   * is the directive `X-Frame-Options` cannot express (it has no per-origin
   * form that every browser agrees on).
   */
  "frame-ancestors 'none'",
  // Form posts go to us. WorkOS is reached by top-level NAVIGATION, which this
  // directive does not govern, so there is nothing to allowlist.
  "form-action 'self'",
  // Avatars come from WorkOS and from Google's user-content hosts; connector
  // brand marks are inline SVG. `https:` rather than an enumerated list
  // because an avatar host that changes must not blank every profile picture.
  "img-src 'self' data: blob: https:",
  // Tailwind ships a stylesheet, but React still sets inline styles for the
  // things that are computed — a tile's height, the progress bar's width.
  "style-src 'self' 'unsafe-inline'",
  // See the note above: this is the weak directive and it is weak on purpose.
  // `'unsafe-eval'` is dev-only — React Refresh needs it; production does not.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // The browser talks to us and to WorkOS's token endpoint. Every provider
  // call is made server-side, so none of them belong here.
  "connect-src 'self' https://api.workos.com https://*.workos.com" + (isDev ? " ws: http://localhost:*" : ""),
  "font-src 'self' data:",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

/**
 * HSTS WITHOUT `preload`, deliberately. Two years of `max-age` with subdomains
 * is the strong part; `preload` is a submission to a list baked into browser
 * binaries and effectively permanent — it belongs to whoever owns the apex
 * domain and every subdomain it will ever have, which is a decision for a
 * person and not for a config file.
 */
const headers = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  /**
   * `strict-origin-when-cross-origin` — send the full URL only to ourselves,
   * the bare origin cross-site, nothing at all when downgrading to http. It is
   * the modern default in most browsers and is set explicitly because "most"
   * is not "all", and because the thing being protected is a capability UUID.
   */
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses a camera, a microphone or a location. Saying so removes
  // the prompt as an attack surface entirely.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  /**
   * COOP isolates this window from anything it opens or that opens it, which
   * closes the cross-window scripting routes (`window.opener` reaching back).
   * `same-origin-allow-popups` rather than `same-origin`: the OAuth start route
   * is a top-level navigation today, but a popup flow is the normal shape for
   * one and this leaves that door open rather than breaking it later.
   */
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * THE APP LOGOS DROPPED INTO `public/app-icons/`, listed at build time — see
   * `scripts/lib/app-icons.mjs` for why the build does the listing, and
   * `src/connectors/app-icons.ts` for how a file finds its app.
   */
  env: {
    APP_ICONS: JSON.stringify(scanAppIcons(fileURLToPath(new URL("./public/app-icons", import.meta.url)))),
  },
  // The dev-tools button defaults to bottom-left — the exact pixels where the
  // navigation rail keeps the account avatar, so in every dev session the
  // overlay sat on top of a real control and swallowed its clicks. Dev-only
  // either way; production never renders the indicator.
  devIndicators: { position: "bottom-right" },
  async headers() {
    // Every path, including static assets and the machine endpoints the auth
    // proxy's matcher deliberately excludes — those are exactly the routes a
    // header set in middleware would have missed.
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;
