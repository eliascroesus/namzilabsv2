import { rawEvents } from "@/db/schema";
import type { DB } from "@/db/types";

export type StoreRawInput = {
  orgId: string;
  connectionId: string;
  source: string;
  headers: Record<string, string>;
  payload: unknown;
  signatureValid: boolean;
};

/**
 * Persist the exact inbound payload to the immutable raw_events table. This runs
 * inside the webhook request (before the fast 202 ack), so nothing is ever lost
 * even if downstream processing later fails.
 */
export async function storeRawEvent(db: DB, input: StoreRawInput) {
  const [row] = await db
    .insert(rawEvents)
    .values({
      orgId: input.orgId,
      connectionId: input.connectionId,
      source: input.source,
      headers: input.headers,
      payload: input.payload as Record<string, unknown>,
      signatureValid: input.signatureValid,
    })
    .returning();
  return row;
}
