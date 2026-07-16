import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections } from "@/db/schema";
import { encrypt, decrypt, getEncryptionKey } from "@/lib/crypto";
import { getConnector } from "@/connectors/registry";
import { catalogEntry } from "@/connectors/catalog";
import { refreshGoogleToken } from "@/lib/google-oauth";
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

export async function updateConnectionConfig(
  orgId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  await getDb()
    .update(connections)
    .set({ config: { ...(conn.config ?? {}), ...patch }, updatedAt: new Date() })
    .where(and(eq(connections.id, id), eq(connections.orgId, orgId)));
}

export async function deleteConnection(orgId: string, id: string): Promise<void> {
  await getDb().delete(connections).where(and(eq(connections.id, id), eq(connections.orgId, orgId)));
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

/**
 * Decrypt credentials, refreshing (and persisting) an expired Google OAuth
 * access token when needed, so poll/preview always use a valid token.
 */
export async function getFreshCredentials(conn: Connection): Promise<Record<string, unknown>> {
  const key = getEncryptionKey();
  const creds: Record<string, unknown> = conn.credentialsEncrypted
    ? JSON.parse(decrypt(conn.credentialsEncrypted, key))
    : {};

  const isGoogle = conn.source === "gsheets" || conn.source === "gcal";
  const expiresAt = typeof creds.expiresAt === "number" ? creds.expiresAt : 0;
  if (isGoogle && typeof creds.refreshToken === "string" && expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshGoogleToken(creds.refreshToken);
    const merged = { ...creds, ...refreshed };
    await getDb()
      .update(connections)
      .set({ credentialsEncrypted: encrypt(JSON.stringify(merged), key), updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    return merged;
  }
  return creds;
}

/** The connect-time "preview latest records" feature. */
export async function previewLatest(orgId: string, id: string, n = 3): Promise<CanonicalEvent[]> {
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  const connector = getConnector(conn.source);
  if (!connector?.testFetchLatest) {
    throw new Error("Preview isn't available for this source (it's webhook-only — send a test event instead).");
  }
  const credentials = await getFreshCredentials(conn);
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
