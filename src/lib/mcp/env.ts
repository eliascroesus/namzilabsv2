/**
 * The only place MCP configuration is read. Three switches:
 *   MCP_ENABLED           "1" turns the route and the well-known documents on.
 *   WORKOS_AUTHKIT_DOMAIN the OAuth issuer and JWKS host (https://<x>.authkit.app).
 *   MCP_RESOURCE_URL      the exact URL customers paste into Claude/ChatGPT and the
 *                         audience every token must carry; defaults to APP_BASE_URL + /api/mcp.
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
  return `${base}/api/mcp`;
}

export function mcpMaxScanRows(): number {
  const n = Number(process.env.MCP_MAX_SCAN_ROWS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200_000;
}
