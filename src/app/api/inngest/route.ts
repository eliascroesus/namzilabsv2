import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Inngest's HTTP entrypoint. Vercel invokes registered functions through here.
export const runtime = "nodejs";

/**
 * Serverless duration budget.
 *
 * Vercel's default is 10s on Hobby and 15s on Pro. Neither is survivable for
 * this route: a sync issues a provider call (bounded at PROVIDER_CALL_BUDGET_MS
 * in src/lib/http-client.ts) plus ten or more Neon round trips, each of which is
 * its own HTTPS request on the http driver. Under the default the container is
 * killed mid-run — Inngest sees a failure, and the test_runs row is stranded at
 * `running` because it is stamped before the work starts.
 *
 * 60 is the Hobby ceiling and is valid on Pro too; raise to 300 on Pro if a
 * first sync ever needs it. Whatever this is, it MUST stay above the HTTP
 * budget in src/lib/http-client.ts — tests/http-client.test.ts pins that.
 */
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
