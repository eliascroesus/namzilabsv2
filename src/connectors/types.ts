/**
 * The canonical event every connector produces. This is the single shape the
 * whole product (metrics, dashboard) is built on. Adding a new connector means
 * implementing `normalize` (and ideally `poll`) — nothing downstream changes.
 */
export type CanonicalEvent = {
  /** Stable, globally-unique dedup key (connector namespaces it with source+connection). */
  eventId: string;
  eventType: string;
  subject?: string | null;
  occurredAt: Date;
  value?: number | null;
  currency?: string | null;
  properties?: Record<string, unknown>;
};

export type VerifyArgs = {
  /** Exact raw request body bytes as a string (HMAC must be computed over these). */
  rawBody: string;
  headers: Record<string, string>;
  /** The connection's decrypted signing secret, if one is configured. */
  secret?: string | null;
};

export type NormalizeContext = {
  connectionId: string;
  headers?: Record<string, string>;
};

export type PollArgs = {
  connectionId: string;
  /** Opaque cursor from the previous poll (sync token, timestamp, row number, ...). */
  cursor: string | null;
  /** Decrypted credentials for the connection, if any. */
  credentials?: Record<string, unknown> | null;
  config?: Record<string, unknown>;
};

export type PollResult = {
  records: CanonicalEvent[];
  nextCursor: string | null;
};

export type RegisterWebhookArgs = {
  connectionId: string;
  webhookUrl: string;
  credentials: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type RegisterWebhookResult = {
  /** Signing secret the provider returns (stored encrypted, used to verify). */
  signingSecret?: string;
  /** Provider-side subscription id, for later teardown. */
  externalId?: string;
};

/**
 * The contract every integration implements. `verifySignature` + `normalize`
 * power the instant (webhook) path; `poll` powers the reconciliation/backfill
 * safety net; `testFetchLatest` powers the connect-time "preview latest
 * records" UX (Prompt 2).
 */
export interface Connector {
  source: string;
  authType: "apiKey" | "oauth2" | "secret" | "none";
  /** Return true iff the inbound request is authentic (or no verification configured). */
  verifySignature(args: VerifyArgs): boolean;
  /** Map a raw webhook payload into zero or more canonical events. */
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[];
  /** Optional polling for reconciliation/backfill. */
  poll?(args: PollArgs): Promise<PollResult>;
  /** Optional: latest N records for the connect-time preview. */
  testFetchLatest?(n: number, args: PollArgs): Promise<CanonicalEvent[]>;
  /** Optional: auto-create the provider's webhook subscription at connect time. */
  registerWebhook?(args: RegisterWebhookArgs): Promise<RegisterWebhookResult>;
}
