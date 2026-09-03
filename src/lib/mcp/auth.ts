import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { authkitDomain, mcpResourceUrl } from "@/lib/mcp/env";

export type McpAuth = {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
  /**
   * `role` is INFORMATIONAL ONLY: an unverified token claim kept for support
   * logs. Authorization always re-derives the role from the WorkOS membership
   * lookup in workspace.ts; nothing may gate on `extra.role`.
   */
  extra: { userId: string; orgIdClaim: string | null; bindingKey: string; role?: string };
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksFor = "";
function keySet() {
  const domain = authkitDomain();
  if (!jwks || jwksFor !== domain) {
    jwks = createRemoteJWKSet(new URL(`${domain}/oauth2/jwks`));
    jwksFor = domain;
  }
  return jwks;
}

/**
 * Which connected client this token belongs to, as well as the token can
 * say: an OAuth client id, else the authorized party, else the session, else
 * a hash of the token itself (never the token — this value is stored).
 */
export function bindingKeyOf(payload: JWTPayload & Record<string, unknown>, token: string): string {
  const s = (k: string) => (typeof payload[k] === "string" && (payload[k] as string).length > 0 ? (payload[k] as string) : null);
  const client = s("client_id") ?? s("azp");
  if (client) return `client:${client}`;
  const sid = s("sid");
  if (sid) return `session:${sid}`;
  return `token:${createHash("sha256").update(token).digest("hex")}`;
}

/**
 * Verify a bearer token issued by WorkOS AuthKit for THIS resource. Any failure
 * is `undefined`, which mcp-handler turns into a 401 with the RFC 9728
 * challenge. Nothing here ever forwards the token anywhere.
 */
export async function verifyMcpToken(_req: Request, bearerToken?: string): Promise<McpAuth | undefined> {
  if (!bearerToken) return undefined;
  try {
    const { payload } = await jwtVerify(bearerToken, keySet(), { issuer: authkitDomain(), audience: mcpResourceUrl() });
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!sub) return undefined;
    const p = payload as JWTPayload & Record<string, unknown>;
    const orgIdClaim = typeof p.org_id === "string" && p.org_id ? (p.org_id as string) : null;
    const role = typeof p.role === "string" ? (p.role as string) : undefined;
    const scopes = typeof p.scope === "string" ? (p.scope as string).split(" ").filter(Boolean) : [];
    return {
      token: bearerToken,
      clientId: bindingKeyOf(p, bearerToken),
      scopes,
      expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
      extra: { userId: sub, orgIdClaim, bindingKey: bindingKeyOf(p, bearerToken), role },
    };
  } catch {
    return undefined;
  }
}
