import { NextResponse } from "next/server";
import { protectedResourceHandler, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { authkitDomain, mcpEnabled, mcpResourceUrl } from "@/lib/mcp/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!mcpEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const handler = protectedResourceHandler({ authServerUrls: [authkitDomain()] });
  const res = await handler(req);
  // Say exactly which resource this is and which scopes exist; the handler's
  // default resource is derived from the request URL, which is wrong behind a proxy.
  const body = (await res.json()) as Record<string, unknown>;
  return NextResponse.json({ ...body, resource: mcpResourceUrl(), scopes_supported: ["openid", "profile", "email", "offline_access"], bearer_methods_supported: ["header"] }, { headers: { "cache-control": "public, max-age=300" } });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
