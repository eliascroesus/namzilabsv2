/**
 * The only place MCP configuration is read. Three switches:
 *   MCP_ENABLED           "1" turns the route and the well-known documents on.
 *   WORKOS_AUTHKIT_DOMAIN the OAuth issuer and JWKS host (https://<x>.authkit.app).
 *   MCP_RESOURCE_URL      the exact URL customers paste into Claude/ChatGPT and the
 *                         audience every token must carry; defaults to APP_BASE_URL + /api/mcp.
 *
 * `mcpMaxScanRows` lived here through Task 10 as prep for the Phase 2
 * `query_events` drill-down tool, which Phase 1 never shipped — no tool in
 * this file's TOOLS array scans a row-bounded table. Removed rather than
 * left as a no-caller export (check-orphans.ts); Phase 2 re-adds it beside
 * the tool that actually reads it.
 */
export function mcpEnabled(): boolean {
  return process.env.MCP_ENABLED === "1";
}

export function authkitDomain(): string {
  const raw = (process.env.WORKOS_AUTHKIT_DOMAIN ?? "").trim().replace(/\/+$/, "");
  if (!raw) throw new Error("WORKOS_AUTHKIT_DOMAIN is not set");
  return raw;
}

export function mcpResourceUrl(): string {
  const override = (process.env.MCP_RESOURCE_URL ?? "").trim();
  if (override) return override.replace(/\/+$/, "");
  const base = (process.env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("MCP_RESOURCE_URL is not set, and APP_BASE_URL is not set to derive a default from");
  return `${base}/api/mcp`;
}
