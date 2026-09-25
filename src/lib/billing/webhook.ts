import type Stripe from "stripe";
import type { DB } from "@/db/types";
import { syncSubscription, type StripeClient } from "./stripe";

/**
 * WHAT A STRIPE EVENT MEANS TO US — always "go and read that subscription".
 *
 * The event body is a hint about WHICH subscription moved, never about its
 * state: events arrive out of order and more than once, so the only state
 * worth writing is the one Stripe returns now (`syncSubscription`). That makes
 * every event idempotent and a late, stale one harmless.
 */

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
]);

const INVOICE_EVENTS = new Set(["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required"]);

type Obj = Record<string, unknown>;
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && typeof (v as Obj).id === "string" ? ((v as Obj).id as string) : null);

/** The subscription an event is about, whatever the event's shape. Null for events we do not use. */
export function subscriptionOf(event: Stripe.Event): string | null {
  const o = event.data.object as unknown as Obj;
  if (SUBSCRIPTION_EVENTS.has(event.type)) return idOf(o.id);
  if (event.type === "checkout.session.completed") return idOf(o.subscription);
  if (INVOICE_EVENTS.has(event.type)) {
    // Since API 2025-03-31 an invoice names its subscription under `parent`.
    const parent = o.parent as Obj | undefined;
    const details = parent?.subscription_details as Obj | undefined;
    return idOf(details?.subscription) ?? idOf(o.subscription);
  }
  return null;
}

export async function handleBillingEvent(db: DB, event: Stripe.Event, client?: StripeClient): Promise<{ orgId: string | null } | null> {
  const subscriptionId = subscriptionOf(event);
  if (!subscriptionId) return null;
  return syncSubscription(db, subscriptionId, client);
}
