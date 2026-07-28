import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections, sourceStreams } from "@/db/schema";
import { encrypt, decrypt, getEncryptionKey } from "@/lib/crypto";
import { getConnector } from "@/connectors/registry";
import { catalogEntry } from "@/connectors/catalog";
import { getConnectionCredentials } from "@/lib/credentials";
import { restoreConnectionEvents, retireConnectionEvents } from "@/lib/sync/retire-connection";
import { inngest } from "@/inngest/client";
import type { CanonicalEvent } from "@/connectors/types";

export type Connection = typeof connections.$inferSelect;

/** The public inbound URL an external app / provider posts webhooks to. */
export function webhookUrlFor(connectionId: string): string {
  const base = process.env.APP_BASE_URL ?? "";
  return `${base}/api/webhooks/${connectionId}`;
}

function randomSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export type CreateConnectionInput = {
  orgId: string;
  source: string;
  name: string;
  authType?: "apiKey" | "oauth2" | "secret" | "none";
  credentials?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

/**
 * Create an org-scoped connection with encrypted credentials. If the connector
 * supports auto-registering its provider webhook, do so and store the returned
 * signing secret; otherwise mint an inbound signing secret for instant sources
 * so the user can configure the provider manually.
 */
export async function createConnection(input: CreateConnectionInput): Promise<Connection> {
  const db = getDb();
  const key = getEncryptionKey();
  const [created] = await db
    .insert(connections)
    .values({
      orgId: input.orgId,
      source: input.source,
      name: input.name,
      status: "active",
      authType: input.authType ?? "apiKey",
      credentialsEncrypted: encrypt(JSON.stringify(input.credentials ?? {}), key),
      config: input.config ?? {},
    })
    .returning();

  const entry = catalogEntry(input.source);
  const connector = getConnector(input.source);
  const webhookUrl = webhookUrlFor(created.id);

  let signingSecret: string | undefined;
  let externalId: string | undefined;

  if (entry?.autoWebhook && connector?.registerWebhook) {
    try {
      const res = await connector.registerWebhook({
        connectionId: created.id,
        webhookUrl,
        credentials: input.credentials ?? {},
        config: input.config,
      });
      signingSecret = res.signingSecret;
      externalId = res.externalId;
    } catch (err) {
      await db
        .update(connections)
        .set({ status: "error", lastError: `webhook registration failed: ${msg(err)}`, updatedAt: new Date() })
        .where(eq(connections.id, created.id));
    }
  } else if (entry?.instant) {
    signingSecret = randomSecret();
  }

  const patch: Partial<Connection> = {};
  if (signingSecret) patch.signingSecretEncrypted = encrypt(signingSecret, key);
  if (externalId) patch.config = { ...(created.config ?? {}), externalId };
  if (Object.keys(patch).length > 0) {
    await db
      .update(connections)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(connections.id, created.id));
  }

  // Kick off the initial historical backfill for poll-capable sources.
  if (connector?.poll) {
    try {
      await inngest.send({ name: "sync/connection.requested", data: { connectionId: created.id, mode: "full" } });
    } catch {
      // Inngest not configured (e.g. local dev without keys) — don't block connect.
    }
  }

  return (await getConnection(input.orgId, created.id))!;
}

export async function listConnections(orgId: string): Promise<Connection[]> {
  return getDb().select().from(connections).where(eq(connections.orgId, orgId)).orderBy(desc(connections.createdAt));
}

/** Always org-scoped: a connection is only returned to its owning organization. */
export async function getConnection(orgId: string, id: string): Promise<Connection | null> {
  const [row] = await getDb()
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Rename a connection (user-editable label, e.g. "Sheets — sales team"). */
export async function updateConnectionName(orgId: string, id: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return;
  await getDb()
    .update(connections)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(connections.id, id), eq(connections.orgId, orgId)));
}

/**
 * Take a connection the user no longer wants out of circulation — WITHOUT
 * destroying it.
 *
 * This used to hard-delete the connection row and its streams. That made
 * reconnecting impossible to do well rather than merely inconvenient: every
 * connector namespaces its `eventId` with the connection UUID
 * (`calendly.ts`, `close.ts`, `google-sheets.ts`, …), so a delete-and-re-add
 * imports a SECOND complete copy of the dataset under new ids, with the old
 * copy tombstoned beside it. Matching the provider account afterwards cannot
 * merge them; it can only tell you there are two.
 *
 * Keeping the row keeps the UUID, and that is the whole trick. `status` already
 * supported `disabled` and was already honoured by the webhook route and the
 * sweep — nothing ever wrote it. So disconnecting sets it, and reconnecting is
 * `status = active` plus clearing the tombstones, with no provider call and no
 * re-import.
 *
 * Order is still deliberate: retire the events FIRST. `events.connection_id`
 * has no foreign key, so a failure after the connection was already gone would
 * strand live rows that classic org-wide metrics still count, with nothing left
 * in the UI to retry from. Retiring first means a failure is simply re-runnable.
 *
 * Streams are disabled rather than deleted, for the same reason as the row: a
 * stream carries the resource a flow declared, and re-deriving it on reconnect
 * would mean re-reading every flow graph. The sweep already filters on
 * `status`, so a disabled stream costs nothing.
 */
export async function disableConnection(orgId: string, id: string): Promise<{ retiredEvents: number }> {
  const db = getDb();
  const retiredEvents = await retireConnectionEvents(db, orgId, id);
  const now = new Date();
  await db
    .update(connections)
    .set({
      status: "disabled",
      // Stamped only on the way IN to disabled, never refreshed, because it is
      // the clock a later purge runs on: re-stamping it on a second disconnect
      // of an already-disabled connection would reset the retention window.
      disabledAt: now,
      // A disabled connection is not paused, breaker-tripped or mid-import.
      // Leaving that state behind would make the connection page describe a
      // retry that is never going to happen.
      pausedUntil: null,
      pausedReason: null,
      nextSweepAt: null,
      updatedAt: now,
    })
    .where(and(eq(connections.id, id), eq(connections.orgId, orgId), ne(connections.status, "disabled")));
  await db
    .update(sourceStreams)
    .set({ status: "disabled", updatedAt: now })
    .where(and(eq(sourceStreams.connectionId, id), eq(sourceStreams.orgId, orgId)));
  return { retiredEvents };
}

/**
 * Put a disconnected integration back, exactly as it was.
 *
 * Free, because nothing was destroyed: the connection UUID survived, so every
 * event this connection ever wrote still carries ids that match what its
 * connector would produce today. Clearing the tombstones restores them in
 * place. No provider call, no backfill, no duplicate dataset.
 *
 * Credentials are NOT touched. A user reconnecting because a token expired
 * still has to re-authorise, and that path already exists; this is about the
 * data, and about not making them choose between keeping their history and
 * fixing their auth.
 */
export async function reconnectConnection(orgId: string, id: string): Promise<{ restoredEvents: number }> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .update(connections)
    .set({
      status: "active",
      disabledAt: null,
      // Re-armed the same way a reset re-arms: a connection that has been
      // sitting disabled must sweep on the next tick rather than inherit a
      // stale schedule.
      syncStatus: "synced",
      lastError: null,
      consecutiveFailures: 0,
      consecutiveNoOpSweeps: 0,
      nextSweepAt: null,
      updatedAt: now,
    })
    .where(and(eq(connections.id, id), eq(connections.orgId, orgId), eq(connections.status, "disabled")))
    .returning({ id: connections.id });
  // Nothing was disabled — either it is already active or it is not ours. Say
  // nothing happened rather than un-tombstoning rows on a connection whose
  // disconnect is still in progress.
  if (rows.length === 0) return { restoredEvents: 0 };

  await db
    .update(sourceStreams)
    .set({ status: "active", updatedAt: now })
    .where(and(eq(sourceStreams.connectionId, id), eq(sourceStreams.orgId, orgId), eq(sourceStreams.status, "disabled")));
  const restoredEvents = await restoreConnectionEvents(db, orgId, id);
  return { restoredEvents };
}

/** Decrypt the connection's signing secret for display (manual webhook setup). */
export function getSigningSecret(conn: Connection): string | null {
  if (!conn.signingSecretEncrypted) return null;
  try {
    return decrypt(conn.signingSecretEncrypted, getEncryptionKey());
  } catch {
    return null;
  }
}

/** The connect-time "preview latest records" feature. */
export async function previewLatest(orgId: string, id: string, n = 3): Promise<CanonicalEvent[]> {
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  const connector = getConnector(conn.source);
  if (!connector?.testFetchLatest) {
    throw new Error("Preview isn't available for this source (it's webhook-only — send a test event instead).");
  }
  const credentials = await getConnectionCredentials(getDb(), conn);
  return connector.testFetchLatest(n, {
    connectionId: conn.id,
    cursor: null,
    credentials,
    config: conn.config ?? undefined,
  });
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
