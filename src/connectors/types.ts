import type { ObservedRateLimit } from "@/lib/http-client";

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
  /**
   * How to date this payload, for a source whose JSON has no schema.
   * `PollArgs.dateField`'s twin — same question, the other door.
   *
   * ABSENT means the pre-feature behaviour, and that is not a default so much as
   * a freeze. Dating new events better while old ones keep their old answer puts
   * two meanings inside one metric with nothing on screen to say so — worse than
   * being uniformly wrong. So the whole change, parser included, sits behind
   * this field, and the caller only supplies it once it is also going to restamp
   * what is already stored.
   *
   * PRESENT means the resolved answer: `key` is the payload key to date from
   * (one level of nesting is addressable — `data.created_at` — because provider
   * payloads routinely wrap), or null when nothing was resolved, in which case
   * the delivery moment is the answer and is stated as such.
   */
  eventTime?: { key: string | null };
  /**
   * What `occurred_at` should be when the payload carries no usable timestamp.
   *
   * The delivery moment, supplied by the caller because the CONNECTOR does not
   * know it — `new Date()` is only the delivery moment on the first pass, and a
   * redelivery or a reprocess stamps whenever that happened to run. Harmless
   * while `preserveOccurredAt` pins the first write; wrong the moment anything
   * re-derives, which is exactly what a restamp does.
   */
  fallbackOccurredAt?: Date;
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
  /**
   * How far back this stream must reach, overriding the connector's default.
   *
   * A connector that honours it MUST use the same value for the request bound
   * AND for the `retireOutsideWindow` it declares. That is the whole point:
   * split them and a deepened import is retired by the next sweep, because the
   * declared window still describes the default. One value, both purposes, so
   * they cannot disagree.
   *
   * Null means "your default", which is what every stream says until something
   * deliberately deepens it.
   */
  windowFloor?: Date | null;
  /**
   * Which field of the source's own payload holds a record's event time, when
   * the source has no timestamp of its own and the user has nominated one.
   *
   * A spreadsheet row is the case: it has no inherent event time, so the Sheets
   * connector stamped `occurred_at` with `new Date()` — the import moment — and
   * every time-based metric over a sheet measured when the data was imported.
   * The real date was in a column all along.
   *
   * PER STREAM, like `windowFloor`, and for a related reason: `occurred_at` is a
   * fact about a ROW, and a stream's rows are shared by every flow reading it.
   * Two flows cannot hold different opinions about when something happened.
   *
   * NULL means the connector's own answer, which for a source with real
   * timestamps is the provider's, and for a sheet is first-seen — unless
   * {@link detectDateField} is set, in which case the connector finds one.
   */
  dateField?: string | null;
  /**
   * "Nobody has answered the date question for this stream — find the column
   * yourself."
   *
   * Set when the picker has never been used. It is the DEFAULT state, and that
   * is the point: a sheet with an obvious date column dating its rows from the
   * import moment until somebody notices is broken by default, and the fix has
   * to be the default too. A connector must still report what it decided
   * (`dateFieldState.source`), because a guess nobody can see is worse than
   * none.
   *
   * Ignored when {@link dateField} is set — an explicit column is an answer, and
   * detection must not second-guess it.
   */
  detectDateField?: boolean;
  /**
   * "Read even if you believe nothing changed."
   *
   * Set for the one sweep that follows a change to {@link dateField}, because
   * every stored row is about to be restamped FROM this read — so a connector
   * that answers "unchanged" hands back an empty record set and the restamp
   * silently does nothing. The known way for that to happen is Sheets' Drive
   * `modifiedTime` probe: the sheet genuinely has not changed, which is exactly
   * why it must still be read. What changed is our reading of it.
   *
   * A connector with no such short-circuit can ignore this; it only ever asks
   * for the read that would otherwise have been skipped, never for a different
   * one.
   */
  restamp?: boolean;
};

/** One choice for a dynamic flow-level field (e.g. a spreadsheet, a tab). */
export type SourceOption = { value: string; label: string };

export type ListOptionsArgs = {
  connectionId: string;
  credentials?: Record<string, unknown> | null;
  /** The flow-level config chosen so far (for dependent fields, e.g. tabs need the spreadsheet). */
  config?: Record<string, unknown>;
};

/**
 * How much of a window an import actually holds, as two SPANS.
 *
 * One shape for both producers — a connector mid-walk and the backfill lane —
 * so a tile, a Test note and a dashboard cannot each measure progress its own
 * way. See `PollResult.importProgress` for why spans and not instants.
 */
export type ImportCoverage = { coveredMs: number; targetMs: number };

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
   * How much of the window this import has actually ingested, against how much
   * it is trying to. Paired with `incomplete` it is what lets the editor say
   * "covering 12 of 30 days" instead of showing a bare number that climbs for a
   * day.
   *
   * TWO SPANS, NOT TWO INSTANTS — and that is the whole design.
   *
   * This was `{reachedBack, targetBack}`: the oldest record ingested so far,
   * against the floor being aimed at. That measures progress ONLY if the walk
   * runs newest-first. On an oldest-first log the first page lands at the floor,
   * so `reachedBack` equals `targetBack` immediately and the note claims full
   * coverage of the window while holding a fraction of its events — a number
   * announcing itself as finished while still climbing, which is the exact
   * failure the note was added to prevent.
   *
   * No provider here is actually ordered that way — Close's Event Log is
   * newest-first, and a verification run that said otherwise turned out to be a
   * bug in the check (`close.ts`, above `FIRST_RUNG_DAYS`). The shape stayed
   * anyway: this is a CONTRACT every connector implements, the ordering is the
   * provider's to change, and a number that is right only by coincidence is one
   * nobody can check.
   *
   * A span cannot do that. `coveredMs` is (newest ingested − oldest ingested):
   * it starts near zero and grows toward `targetMs` whichever end the walk
   * started from, so no consumer has to know, or guess, which way a provider
   * orders its results.
   *
   * Deliberately not called `covered`, and deliberately not reusing
   * `retireOutsideWindow` — both name the window a source DECLARES, and this
   * names what has actually landed. Confusing the two would let a note claim
   * coverage that has not arrived yet. It also carries no side effect
   * whatsoever: nothing retires, nothing is bounded by it.
   */
  importProgress?: ImportCoverage;
  /**
   * What this read actually did about a row's event time.
   *
   * Reported rather than inferred, because the ways it can go differ need
   * different fixes and are indistinguishable from the outside. A renamed column
   * and a column full of malformed dates both produce "every row undated"; only
   * the connector, which has the header row in hand, can say which happened. And
   * a DETECTED column has to announce itself — a guess the user cannot see is
   * the failure this whole feature exists to remove.
   *
   * `column` is null when nothing dated the rows: no column chosen, none
   * detected, or several detected and therefore none used (`candidates`). Say it
   * rather than omitting the field, so "we looked and found nothing" stays
   * distinguishable from "we never looked".
   *
   * `at` is added by the runner — the connector does not own the clock that
   * decides when a row was written.
   */
  dateFieldState?: {
    column: string | null;
    source: "user" | "detected";
    presentInHeader: boolean;
    dated: number;
    undated: number;
    candidates?: string[];
  };
  /**
   * WHICH records the read could not date — the ids behind
   * `dateFieldState.undated`, not just the count.
   *
   * Needed only by the restamp, and it cannot be derived anywhere else. A row
   * with no usable date must fall back to `events.received_at`, which lives in
   * the database the connector has no handle on; the runner has the handle but
   * cannot tell a date the connector PARSED from the fallback it SYNTHESIZED —
   * both arrive as a `Date` on `occurredAt`. Guessing (say, "anything stamped
   * within a second of now") would be the silent-wrong-answer class this whole
   * feature exists to remove, so the connector says it outright.
   *
   * A Set because every use is a membership test over the same read's records.
   *
   * Omitting it means "I dated everything I was asked to" — the safe default for
   * a source whose records carry real timestamps, since the runner then leaves
   * the connector's own `occurredAt` alone. It is NOT the way to say "no column
   * is set": the runner already knows that from the stream, and treats every row
   * as undated in that case.
   */
  undatedEventIds?: Set<string>;
  /**
   * How many provider requests this poll actually made.
   *
   * The runner claims budget per page for STREAM-scoped sources, where it drives
   * the page loop itself. A connection-scoped source is called once and pages
   * INSIDE the connector, so those requests are invisible to the runner and the
   * ledger under-counted them by up to the connector's page budget. Reporting
   * the real number lets the ledger settle up: it cannot un-spend a call, but it
   * can stop the NEXT sweep from being authorised on a false reading.
   *
   * Omit it and the poll is counted as one request, which is correct for a
   * connector that makes one.
   */
  providerCalls?: number;
  /**
   * How many of `providerCalls` went to a DIFFERENT operation than the one the
   * runner claimed against, keyed by operation.
   *
   * One poll does not always mean one endpoint. Sheets reads a tab through the
   * Sheets API and asks Drive whether the file changed at all — two APIs, with
   * quotas 40× apart (300/min per project versus 12,000). Counted as one
   * operation, the tighter of the two has to govern both, so a Drive probe that
   * costs Google almost nothing gets throttled at the Sheets ceiling for no
   * provider-side reason.
   *
   * The runner subtracts these from the primary operation's spend rather than
   * adding them on, so the total charged still equals `providerCalls` — an
   * attribution, not an extra charge.
   */
  extraCalls?: Record<string, number>;
  /**
   * What the provider said was left of ITS budget, from its own response
   * headers — observed truth, as opposed to the figure declared in the catalog.
   *
   * A `remaining` of 0 defers the connection until the stated reset, which is
   * strictly better than discovering the limit through a 429.
   */
  rateLimit?: ObservedRateLimit;
  /**
   * "The resource has not changed since the marker you gave me, so I did not
   * read it." `records` is empty because nothing was FETCHED — not because the
   * resource is empty.
   *
   * MIRROR SOURCES MUST SET THIS WHEN THEY SKIP, and the runner must honour it,
   * because the two look identical and the consequence is not: a mirror's empty
   * read means "every row was deleted upstream" and `retireAbsent` would
   * tombstone the entire sheet. This flag is the difference between an
   * efficient sweep and a data-loss event.
   */
  unchanged?: boolean;
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
  /**
   * This endpoint has REFUSED at least one delivery inside the recent window —
   * i.e. we have direct evidence that deliveries arriving now would be rejected.
   *
   * Passed in rather than looked up, because the answer lives in `delivery_log`
   * and connectors do not reach the database. The caller (`reconcile`) reads it
   * with `rejectingConnections` and hands down a boolean, which keeps the
   * decision that uses it a pure function of its arguments.
   *
   * A connector that can switch a paused subscription back on must consult this
   * first: turning deliveries back on toward an endpoint known to reject them
   * restarts a failure cycle rather than repairing anything.
   */
  recentlyRejecting?: boolean;
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
  /**
   * Map a raw webhook payload into zero or more canonical events.
   *
   * OPTIONAL, because for a stream-scoped source there is no inbound path to
   * map: the webhook route answers `isStreamScoped` before verification or
   * storage, rings the connection's doorbell and returns. Google Sheets carried
   * a `normalize` for months that nothing could reach, guessing a hard-coded
   * `row["timestamp"]` while the poll path stamped `new Date()` — two different
   * wrong answers for one source, and the unreachable one is why the divergence
   * was never contradicted by anything.
   *
   * Omit it when the source has no reachable inbound path. If one is ever built,
   * it gets built against the same `dateField` the poll uses.
   */
  normalize?(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[];
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
  /**
   * "Is this stored cursor a live continuation I must come back to before it
   * expires?" — as opposed to a settled mark that can sit for as long as it
   * likes.
   *
   * The cadence layer widens the gap between sweeps when a connection looks
   * idle, and a connector that persists a PROVIDER-ISSUED continuation across
   * sweeps is not idle: it is holding something with a lifetime. Calendly is the
   * measured case — CL13 found its `next_page` URL accepted at 600s and refused
   * at 3600s — and the reuse gap is 600-1200s, because `next_sweep_at` is set to
   * <end of sweep> + 600s and the sweep cron only fires every 600s. Age the URL
   * past its life and the outward scan restarts at page 1 every sweep, forever,
   * with no error anywhere because the restart succeeds.
   *
   * WHY THE CONNECTOR ANSWERS AND NOT THE RUNNER. "A cursor exists" is a
   * different question and a wrong one. Three of the four stream-scoped sources
   * keep a non-null cursor for the life of the connection — Calendar's sync
   * token, Sheets' change-detection marker, Instantly's bare high-water mark —
   * so keying on non-null would pin every Google connection at base cadence
   * permanently and repeal H.1/H.2. Nor can the shape be sniffed: the cursor is
   * declared opaque here ("sync token, timestamp, row number, …"), and the one
   * convention that looks generic — a leading `{` — is exactly wrong for Sheets,
   * whose SETTLED marker is also JSON.
   *
   * A PURE FUNCTION OF THE CURSOR, not a field on `PollResult`, and that is
   * load-bearing rather than stylistic. When the stream write-lock is contended
   * the runner discards the poll's result and re-persists the PREVIOUS cursor,
   * so a per-poll flag would describe a cursor that is not the one stored — and
   * that path is the motivating case, since it is the one exit that leaves a
   * continuation stored without the page-budget rule noticing.
   *
   * Omitting it means "nothing I persist expires", which is the right answer for
   * Calendar and Sheets and the safe default for anything new: an undeclared
   * connector is never pinned.
   */
  holdsContinuation?(cursor: string | null): boolean;
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
