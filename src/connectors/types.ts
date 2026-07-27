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
  /**
   * Where the next poll of this stream should resume.
   *
   * **`null` means START OVER.** The connector has finished its scan, or the
   * token it was handed is no longer usable, and the next poll should begin from
   * scratch. A connector that means "nothing changed, keep what you had" must
   * return `args.cursor` — the value it was given — not null.
   *
   * This has to be stated because the two readings are indistinguishable in the
   * type and the runner used to implement the other one (`cursor = nextCursor ??
   * cursor`). Two connectors already assumed reset and were silently broken by
   * it: Calendly pinned itself to the last page of its first scan and never saw
   * another booking, and Google Calendar re-sent an expired sync token forever
   * after a single 410. Both are one-line "return null" sites, which is exactly
   * why the ambiguity was invisible.
   */
  nextCursor: string | null;
  /**
   * "This read is COMPLETE for this slice of time" — the connector's declaration
   * that `records` is the whole truth for `[from, to]`, so anything stored in
   * that window which the read did not produce no longer exists upstream and
   * should be retired.
   *
   * This is what makes a rolling-window mirror possible. A whole-resource mirror
   * (a spreadsheet tab) can retire everything the read omitted, because the read
   * covered everything. A rolling window cannot: a read of the last 30 days says
   * nothing about day 31, and retiring on that basis would delete all history
   * older than the window on every single sweep.
   *
   * Set it only when the read genuinely enumerates the window. Omitting it is
   * always safe — the stream is then treated as incremental and nothing is
   * retired.
   */
  mirrorScope?: { from: Date; to: Date };
  /**
   * "This stream covers ONLY this span — anything stored outside it is no longer
   * mine to keep."
   *
   * Different from `mirrorScope`, and the difference matters. `mirrorScope` says
   * the read is COMPLETE for the window, which licenses retiring rows INSIDE it
   * that the read did not produce — only safe when one call returns the whole
   * window. This says nothing about completeness: it retires rows OUTSIDE the
   * window, which depends on the boundary alone and is therefore safe for a
   * paginated source where each call sees a fraction of the data.
   *
   * It exists because a rolling window that only ever adds is not a window. Once
   * Calendly's history window narrowed, the older import sat stranded behind the
   * new floor with a gap in between, and the stored data matched neither the old
   * window nor the new one.
   *
   * REQUIRES that the connector's `occurredAt` be on the same axis as the window
   * it declares here. Calendly's is meeting start time, and the window filters
   * `start_time`; if one were booking time this would tombstone real records.
   */
  retireOutsideWindow?: { from: Date; to: Date };
  /**
   * "These records have no timestamp of their own — keep the first one we saw."
   *
   * A running total is not an event: it did not happen at a time. Stamping it
   * with `now` makes it march forward on every sweep, which reorders it and
   * makes every unchanged sweep look like a change (defeating the no-op skip
   * that keeps dashboards from recomputing every ten minutes). Stamping it with
   * the epoch, as this connector first did, puts 1970 in front of the user.
   *
   * Preserving first-seen is the honest third option: stable, ordered, and true.
   * Window-scoped mirrors get this implicitly — a restated day must keep
   * describing its own day — so they need not set it.
   */
  preserveOccurredAt?: boolean;
  /**
   * "I stopped because I ran out of page budget, not because the source ran out
   * of data." There is more to fetch and the next poll will fetch it.
   *
   * The runner infers this for stream-scoped sources from its own page loop
   * (`syncStream`), but CONNECTION-scoped sources have no such loop — the
   * runner calls `poll` exactly once and the connector's internal walk is
   * invisible to it. Close and Sendblue both knew they were mid-import and had
   * no way to say so, which is why a new account watched a number climb for a
   * day with nothing to explain it.
   *
   * Feeds two things: the cadence (a connection with work outstanding must not
   * be demoted as idle) and the Test's note.
   */
  incomplete?: boolean;
  /**
   * How far back this import has REACHED, against how far it is trying to get.
   * Paired with `incomplete` it is what lets the editor say "covering 12 of 30
   * days" instead of showing a bare number that climbs for a day.
   *
   * Deliberately not called `covered`, and deliberately not reusing
   * `retireOutsideWindow` — both name the window a source DECLARES, and this
   * names what has actually landed. Confusing the two would let a note claim
   * coverage that has not arrived yet. It also carries no side effect
   * whatsoever: nothing retires, nothing is bounded by it.
   */
  importProgress?: { reachedBack: Date; targetBack: Date };
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
