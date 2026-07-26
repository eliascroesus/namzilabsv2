import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

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

export async function GET() {
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

  const healthy = database === "ok" && missingRequired.length === 0;
  return NextResponse.json(
    {
      status: healthy ? (missingBackground.length > 0 ? "degraded" : "ok") : "unhealthy",
      service: "namzilabs",
      time: new Date().toISOString(),
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
