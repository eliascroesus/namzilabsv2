import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { handleBillingEvent } from "@/lib/billing/webhook";

export const runtime = "nodejs";

/**
 * STRIPE → US. The one endpoint Stripe's billing events arrive at.
 *
 * Under `/api/webhooks/`, which the proxy's matcher leaves alone, so no session
 * machinery runs on a machine request; a fixed segment, so it wins over the
 * connectors' `[connectionId]` route beside it.
 *
 * Verified against the RAW body with `STRIPE_WEBHOOK_SECRET` before anything is
 * parsed. A handler failure answers 500, which tells Stripe to retry (it does,
 * for three days); every event is safe to replay — see lib/billing/webhook.ts.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "billing webhooks are not configured" }, { status: 503 });

  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing signature");
    event = Stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "signature did not verify" }, { status: 400 });
  }

  try {
    await handleBillingEvent(getDb(), event);
  } catch (e) {
    console.error("[billing] webhook handling failed", event.type, event.id, e);
    return NextResponse.json({ error: "handling failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
