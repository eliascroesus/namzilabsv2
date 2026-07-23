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
  /**
   * The source reports this record deleted/cancelled. Stored as a soft-delete
   * (`events.deletedAt`) — the record disappears from every flow without the
   * payload ever being lost.
   */
  deleted?: boolean;
};

/**
 * How a source's data is kept 1:1 with the source (the Airbyte/Fivetran model —
 * every stream declares its sync mode):
 *  - "mirror": the source is MUTABLE STATE (a spreadsheet tab, a bookings
 *    window). Every sweep re-reads the full resource, refreshes every record
 *    (ON CONFLICT DO UPDATE), and soft-deletes live rows the scan no longer
 *    saw. After any completed sweep, the stream's live rows ≡ the source.
 *  - "incremental": the source emits EVENTS/CHANGES (webhooks, event logs,
 *    sync tokens). Records append + dedup; a re-delivered record refreshes the
 *    stored copy; explicit deletions arrive as `deleted: true` records.
 */
export type SyncStrategy = "mirror" | "incremental";

/** A stored row a mirror pass is deciding whether to soft-delete. */
export type MirrorRow = { eventId: string; occurredAt: Date; properties: Record<string, unknown> };

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

/**
 * The contract every integration implements. `verifySignature` + `normalize`
 * power the instant (webhook) path; `poll` powers the reconciliation/backfill
 * safety net; `testFetchLatest` powers the connect-time "preview latest
 * records" UX (Prompt 2).
 */
export interface Connector {
  source: string;
  authType: "apiKey" | "oauth2" | "secret" | "none";
  /** How this source's data is kept 1:1 (see {@link SyncStrategy}). */
  syncStrategy: SyncStrategy;
  /**
   * Mirror connectors with a BOUNDED rescan window (e.g. Calendly's rolling
   * ±400-day meeting window): return false for a stored row the scan could not
   * have seen, so it survives soft-delete. Default (absent) = every stored row
   * of the stream is in scope. When in doubt, return false — never delete what
   * the scan can't prove was removed.
   */
  inMirrorScope?(row: MirrorRow, config?: Record<string, unknown>): boolean;
  /**
   * This connector's occurredAt is synthetic ("first time we saw it"), not a
   * source timestamp — the upsert keeps the stored value on conflict so mirror
   * sweeps never churn record order or time bucketing.
   */
  preserveOccurredAt?: boolean;
  /** Return true iff the inbound request is authentic (or no verification configured). */
  verifySignature(args: VerifyArgs): boolean;
  /** Map a raw webhook payload into zero or more canonical events. */
  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[];
  /** Optional polling for reconciliation/backfill. */
  poll?(args: PollArgs): Promise<PollResult>;
  /** Optional: list live choices for a dynamic flow-level field (spreadsheets, tabs, calendars…). */
  listOptions?(key: string, args: ListOptionsArgs): Promise<SourceOption[]>;
  /** Optional: latest N records for the connect-time preview. */
  testFetchLatest?(n: number, args: PollArgs): Promise<CanonicalEvent[]>;
  /** Optional: auto-create the provider's webhook subscription at connect time. */
  registerWebhook?(args: RegisterWebhookArgs): Promise<RegisterWebhookResult>;
}
