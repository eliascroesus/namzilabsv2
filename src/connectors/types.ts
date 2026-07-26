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
  /**
   * Identity of the stream being polled (hash of the resource config). Connectors
   * whose natural ids can collide across resources (e.g. sheet row numbers) must
   * embed it in eventId so two spreadsheets' row 5 stay distinct.
   */
  streamHash?: string | null;
};

/** One choice for a dynamic flow-level field (e.g. a spreadsheet, a tab). */
export type SourceOption = { value: string; label: string };

export type ListOptionsArgs = {
  connectionId: string;
  credentials?: Record<string, unknown> | null;
  /** The flow-level config chosen so far (for dependent fields, e.g. tabs need the spreadsheet). */
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

export type VerifyWebhookArgs = {
  connectionId: string;
  /** Our inbound URL the provider must be pointing a subscription at. */
  webhookUrl: string;
  credentials?: Record<string, unknown> | null;
};

export type VerifyWebhookResult = {
  /** True when a subscription to our URL verifiably exists after this call. */
  healthy: boolean;
  /** True when the subscription was missing and this call re-created it. */
  reregistered: boolean;
  /** Human-readable detail when unhealthy (surfaced on the connection). */
  detail?: string;
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
  /**
   * Which provider endpoint a poll of this config will hit, as a
   * `"resource.verb"` key matching the catalog's `rateLimits`. The budget layer
   * claims against THIS key, so a connector that talks to several endpoints
   * with different published limits gets each one enforced separately instead
   * of everything sharing one bucket.
   *
   * Must be resolvable BEFORE the call — that is why it takes the config rather
   * than being reported by `poll` afterwards; a budget you can only check after
   * spending the call is not a budget.
   *
   * Omitting it (or returning a key the catalog does not declare) falls back to
   * the default budget, which is the correct behavior for a connector whose
   * provider publishes a single account-wide limit. `operations` must list
   * every key this can return — a declared limit nothing ever claims against is
   * dead config, and tests/provider-gateway.test.ts fails on it.
   */
  operationFor?(config?: Record<string, unknown>): string;
  /** Every operation key `operationFor` can return. Checked against the catalog. */
  operations?: readonly string[];
  /** Optional: list live choices for a dynamic flow-level field (spreadsheets, tabs, calendars…). */
  listOptions?(key: string, args: ListOptionsArgs): Promise<SourceOption[]>;
  /** Optional: latest N records for the connect-time preview. */
  testFetchLatest?(n: number, args: PollArgs): Promise<CanonicalEvent[]>;
  /** Optional: auto-create the provider's webhook subscription at connect time. */
  registerWebhook?(args: RegisterWebhookArgs): Promise<RegisterWebhookResult>;
  /**
   * Optional: verify the provider-side subscription still points at our URL and
   * re-create it when missing (webhook-health backstop, run by the sweep).
   */
  verifyWebhookSubscription?(args: VerifyWebhookArgs): Promise<VerifyWebhookResult>;
}
