import { NextResponse } from "next/server";
import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { authkitDomain, mcpEnabled, mcpResourceUrl } from "@/lib/mcp/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mirrors mcp-handler's own `protectedResourceHandler` CORS headers (see
 * `corsHeaders` in node_modules/mcp-handler/dist/index.mjs) so a browser-based
 * MCP client can read this document cross-origin — the same headers
 * `metadataCorsOptionsRequestHandler` already advertises on OPTIONS below.
 *
 * Built directly with the exported `generateProtectedResourceMetadata`
 * rather than `protectedResourceHandler`: that helper has no way to add
 * `scopes_supported`/`bearer_methods_supported` to its body, and the previous
 * approach — call it, re-parse its JSON, rebuild a fresh `NextResponse` with
 * the extra fields merged in — silently dropped these CORS headers along the
 * way, since only the (re-parsed) body survived the rebuild.
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
};

export async function GET(_req: Request) {
  if (!mcpEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [authkitDomain()],
    resourceUrl: mcpResourceUrl(),
    additionalMetadata: { scopes_supported: ["openid", "profile", "email", "offline_access"], bearer_methods_supported: ["header"] },
  });
  return NextResponse.json(metadata, { headers: { ...CORS_HEADERS, "cache-control": "public, max-age=300" } });
}

/** Off = 404 here too: a disabled deploy must not advertise CORS access to a document it otherwise hides. */
export async function OPTIONS() {
  if (!mcpEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  return metadataCorsOptionsRequestHandler()();
}
