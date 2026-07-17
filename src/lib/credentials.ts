import { eq } from "drizzle-orm";
import { connections } from "@/db/schema";
import { encrypt, decrypt, getEncryptionKey } from "@/lib/crypto";
import { refreshGoogleToken } from "@/lib/google-oauth";
import type { DB } from "@/db/types";

type CredConnection = { id: string; source: string; credentialsEncrypted: string | null };

/** Decrypt a connection's stored credentials JSON (returns {} when none/invalid). */
export function decryptCredentials(conn: { credentialsEncrypted: string | null }): Record<string, unknown> {
  if (!conn.credentialsEncrypted) return {};
  try {
    return JSON.parse(decrypt(conn.credentialsEncrypted, getEncryptionKey())) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Return valid credentials for a connection, refreshing an expired Google OAuth
 * access token and persisting the new token (via the provided `db`) when it
 * changes. Used by both scheduled reconciliation and the connect-time preview so
 * they share one correct code path.
 */
export async function getConnectionCredentials(db: DB, conn: CredConnection): Promise<Record<string, unknown>> {
  const creds = decryptCredentials(conn);

  const isGoogle = conn.source === "gsheets" || conn.source === "gcal";
  const expiresAt = typeof creds.expiresAt === "number" ? creds.expiresAt : 0;
  const refreshToken = typeof creds.refreshToken === "string" ? creds.refreshToken : null;

  if (isGoogle && refreshToken && expiresAt < Date.now() + 60_000) {
    const refreshed = await refreshGoogleToken(refreshToken);
    const merged = { ...creds, ...refreshed };
    await db
      .update(connections)
      .set({ credentialsEncrypted: encrypt(JSON.stringify(merged), getEncryptionKey()), updatedAt: new Date() })
      .where(eq(connections.id, conn.id));
    return merged;
  }
  return creds;
}
