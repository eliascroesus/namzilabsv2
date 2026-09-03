import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { safeEqual } from "@/lib/signatures";
import { mcpEnabled, mcpResourceUrl } from "@/lib/mcp/env";

export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * Health check that can actually fail.
 *
 * The previous version returned a static `{status:"ok"}`. It stayed green
 * through an outage in which every background function was being killed by the
 * platform timeout and no connector had synced for hours — which is worse than
 * having no health check at all, because a green check gets cited as evidence
 * that the backend is fine.
 *
 * A health check earns its name by being able to say no. This one reaches the
 * database and reports which required configuration is present. Env vars are
 * reported by NAME and presence only — never a value, not even a prefix.
 */

/** Unset OR empty string: `.env.example` ships `INNGEST_SIGNING_KEY=""`, and
 *  the Inngest SDK's `||` getters treat that as absent. So do we. */
const present = (name: string): boolean => Boolean(process.env[name]);

/** Required for the app to function at all. Missing => unhealthy. */
const REQUIRED = ["DATABASE_URL", "ENCRYPTION_KEY"] as const;

/**
 * Required for BACKGROUND work — syncing, webhook processing, scheduled
 * recomputes. The app still serves pages without these, so their absence is
 * degraded rather than down; but it is exactly the state that previously looked
 * identical to healthy.
 */
const REQUIRED_FOR_BACKGROUND = ["INNGEST_EVENT_KEY", "INNGEST_SIGNING_KEY", "APP_BASE_URL"] as const;

/**
 * Required only when the MCP connection is switched on. Off is not a fault:
 * a deploy before the WorkOS dashboard is configured must not read as degraded.
 *
 * MCP_RESOURCE_URL is NOT listed here: `mcpResourceUrl()` (src/lib/mcp/env.ts)
 * has a documented default (`${APP_BASE_URL}/api/mcp`), so a deploy that only
 * sets APP_BASE_URL is correctly configured. A literal-name check on
 * MCP_RESOURCE_URL alone would false-positive that deploy as degraded — it is
 * checked below by calling `mcpResourceUrl()` itself and catching a throw.
 */
const REQUIRED_FOR_MCP = ["WORKOS_AUTHKIT_DOMAIN"] as const;

/**
 * The full `checks` object is for the OPERATOR, not the internet. This route
 * sits outside the auth proxy on purpose (an uptime monitor has no session),
 * and it used to hand every anonymous caller the list of configured env vars
 * BY NAME plus the raw database error string — which can carry the Neon
 * hostname. Status alone leaks nothing an attacker can use; the detail is
 * gated behind a shared-secret header the monitor sends.
 *
 * Fail CLOSED: when HEALTH_CHECK_TOKEN is unset, nobody gets detail — a
 * missing secret must degrade to less disclosure, never more. Compared with
 * the same length-guarded timing-safe idiom every webhook signature uses.
 */
function authorizedForDetail(req: Request): boolean {
  const token = process.env.HEALTH_CHECK_TOKEN;
  if (!token) return false;
  const presented = req.headers.get("x-health-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return presented.length > 0 && safeEqual(presented, token);
}

export async function GET(req: Request) {
  const checks: Record<string, unknown> = {};

  let database: "ok" | "unreachable" = "unreachable";
  try {
    await getDb().execute(sql`select 1`);
    database = "ok";
  } catch (e) {
    checks.databaseError = e instanceof Error ? e.message : String(e);
  }
  checks.database = database;

  const missingRequired = REQUIRED.filter((n) => !present(n));
  const missingBackground = REQUIRED_FOR_BACKGROUND.filter((n) => !present(n));
  checks.missingRequired = missingRequired;
  checks.missingForBackgroundWork = missingBackground;

  // Stated plainly so it cannot be mistaken for a passing check.
  if (missingBackground.length > 0) {
    checks.warning =
      "Background sync, webhook processing and scheduled recomputes will NOT run without these. " +
      "Data will silently stop refreshing.";
  }

  const missingMcp: string[] = [];
  if (mcpEnabled()) {
    missingMcp.push(...REQUIRED_FOR_MCP.filter((n) => !present(n)));
    try {
      mcpResourceUrl();
    } catch {
      missingMcp.push("MCP_RESOURCE_URL (or APP_BASE_URL)");
    }
  }
  checks.missingForMcp = missingMcp;
  if (missingMcp.length > 0) {
    checks.mcpWarning = "MCP_ENABLED is on but the AI-assistant endpoint cannot verify tokens without these.";
  }

  const healthy = database === "ok" && missingRequired.length === 0;
  const status = healthy ? (missingBackground.length > 0 || missingMcp.length > 0 ? "degraded" : "ok") : "unhealthy";
  const httpStatus = healthy ? 200 : 503;
  // The HTTP status and the status STRING are always derived from the full
  // picture and always public — a monitor without the token still tells up
  // from down. Only the WHY is gated.
  if (!authorizedForDetail(req)) {
    return NextResponse.json({ status }, { status: httpStatus });
  }
  return NextResponse.json(
    { status, service: "namzilabs", time: new Date().toISOString(), checks },
    { status: httpStatus },
  );
}
