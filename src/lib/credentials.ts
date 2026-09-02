import { eq } from "drizzle-orm";
import { connections } from "@/db/schema";
import { encrypt, decrypt, getEncryptionKey } from "@/lib/crypto";
import { refreshGoogleToken } from "@/lib/google-oauth";
import { HttpError } from "@/lib/http-client";
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
    try {
      const refreshed = await refreshGoogleToken(refreshToken);
      const merged = { ...creds, ...refreshed };
      await db
        .update(connections)
        .set({ credentialsEncrypted: encrypt(JSON.stringify(merged), getEncryptionKey()), updatedAt: new Date() })
        .where(eq(connections.id, conn.id));
      return merged;
    } catch (err) {
      // C12 — Google answers a revoked or expired refresh token with 400
      // `invalid_grant`, a permanent state no retry will ever fix. Reworded so
      // the sweep's `lastError` and the connection page tell the user what to
      // do, instead of reading as an opaque "provider failed" forever. Every
      // other failure (a timeout, a 5xx) is transient or already typed for the
      // breaker (recordProviderError/tripBreaker in ingestion/reconcile.ts)
      // and must reach it unchanged.
      if (err instanceof HttpError && err.body.includes("invalid_grant")) {
        throw new Error("Google access has expired or been revoked. Reconnect this Google account from Integrations.");
      }
      throw err;
    }
  }
  return creds;
}
