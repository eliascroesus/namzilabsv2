import type { CanonicalEvent, Connector, ListOptionsArgs, PollArgs, PollResult, SourceOption } from "./types";
import { asObject, parseDate, str } from "./field-utils";
import { normalizeDateValue } from "@/lib/normalize-dates";
import { bearerClient, eventId, requireCredential } from "./kit";

/**
 * Airtable — the same job Google Sheets does, for the same customers, on a
 * source that gives every row a real `createdTime`. A POLL MIRROR per (base,
 * table): every sweep re-reads the whole table, so stored rows equal the table
 * and a deleted row retires.
 *
 * WHY A MIRROR AND NOT A `windowedWalk`. The list-records endpoint has no time
 * filter at all — its parameters are `pageSize`, `maxRecords`, `offset`,
 * `fields`, `filterByFormula`, `sort`, `view`, `cellFormat`, `timeZone`,
 * `userLocale`, `returnFieldsByFieldId` and `recordMetadata`, and not one of
 * them bounds a window. With nothing for a request to bound, there is no field
 * the provider filters on and therefore no honest watermark to advance; the
 * kit's rule ("the watermark is the field the provider FILTERS on") leaves a
 * whole-resource mirror as the only truthful shape. Hence `cursor: null` on the
 * way out — a mirror starts over every time, by construction.
 *
 * NO INBOUND PATH IN THIS BATCH, so `verifySignature` returns false always.
 * Airtable's webhooks are ping-then-fetch (the ping carries no data; payloads
 * are pulled by cursor) and expire after 7 days unless refreshed, which needs a
 * renewal job — a later step. Until it exists, accepting a delivery would mean
 * accepting one we cannot verify the meaning of.
 *
 * Docs read 8 Sep 2026:
 * - https://airtable.com/developers/web/api/list-records — `GET
 *   https://api.airtable.com/v0/{baseId}/{tableIdOrName}`; `pageSize` defaults
 *   to 100 and is capped at 100; the response is `{ records: [{ id,
 *   createdTime, fields }], offset? }` and "the server returns one page of
 *   records at a time" — the `offset` is absent once every record has been
 *   returned. NO time-filter parameter of any kind (no `since`, no
 *   last-modified), which is the fact this whole module is shaped around.
 *   Auth: `Authorization: Bearer <token>`, scope `data.records:read`.
 * - https://airtable.com/developers/web/api/list-bases — `GET /v0/meta/bases`
 *   → `{ bases: [{ id, name, permissionLevel }], offset? }`, up to 1000 bases
 *   per request; scope `schema.bases:read`.
 * - https://airtable.com/developers/web/api/get-base-schema — `GET
 *   /v0/meta/bases/{baseId}/tables` → `{ tables: [{ id, name, primaryFieldId,
 *   fields[], views[] }] }`; same scope.
 * - https://airtable.com/developers/web/api/rate-limits — "5 requests per
 *   second per base", and "50 requests per second for all traffic using
 *   personal access tokens from a given user or service account"; a 429 means
 *   "wait 30 seconds before subsequent requests will succeed". The per-base
 *   figure is the binding one here, because one stream is one base.
 * - https://airtable.com/developers/web/api/field-model — a currency cell is
 *   "Currency value. Symbol set with the field config" and reads as a plain
 *   `number`, i.e. MAJOR units already: nothing here divides by 100, and no
 *   `currency` is claimed, because the code is on the field config and never on
 *   the cell. A collaborator cell reads as `{ id, email?, name? }` and a date
 *   cell as an ISO-8601 string ("2022-09-05").
 * - https://airtable.com/developers/web/api/webhooks-overview — the
 *   notification ping carries only base id, webhook id and a timestamp; the
 *   payloads are fetched separately by cursor, and a webhook "expires after 7
 *   days" unless refreshed. The deferral above.
 *
 * HISTORY: none to lose. A record lives in the base until somebody deletes it,
 * and the list endpoint returns every record currently in the table — so there
 * is no retention horizon to alarm on and no `retention` declared.
 *
 * AGAINST THE PLAN (docs/superpowers/plans/2026-09-07-connectors-batch-1.md,
 * researched 7 Sep): every endpoint, parameter and response shape it names is
 * confirmed by the 8 Sep read above. Three things the live pages say that it
 * did not carry, all taken from the docs: the second rate limit (50 requests
 * per second per token, alongside the 5 per base), the price of a 429 (thirty
 * seconds), and that a webhook's 7-day expiry is extended another 7 days by
 * refreshing it or listing its payloads — which is what the deferred renewal
 * job will hang on.
 */
const API = "https://api.airtable.com/v0";

/** `pageSize` is capped at 100 by the provider (list-records). */
const PAGE_SIZE = 100;

/**
 * How much of a table one sweep reads, and how fast it may ask.
 *
 * `maxPages` × `PAGE_SIZE` = 5,000 records per sweep. A table larger than that
 * mirrors its first 5,000 rows in Airtable's own order and says so
 * (`incomplete`, plus the catalog's `syncNote`) — stated out loud because a
 * silent ceiling on a source whose contract is "stored rows equal the table" is
 * the kind of half-truth this codebase keeps finding.
 *
 * `minGapMs` paces the walk at four requests a second, under the published five
 * per base, so a long read does not spend its way into a 429 whose penalty is
 * thirty seconds. It costs nothing a caller was not already going to pay: fifty
 * requests at five per second take ten seconds whatever we do.
 *
 * A MUTABLE OBJECT, deliberately: a test lowers `maxPages` to drive the
 * truncation branch with three small pages instead of five thousand rows, and
 * zeroes `minGapMs` so the suite does not sleep. Constants that only a test
 * changes are the honest shape for exactly that.
 */
export const AIRTABLE_PAGING = { maxPages: 50, minGapMs: 250 };

/**
 * The span a COMPLETE read declares itself complete for.
 *
 * Not `[epoch, now]`, and the difference is a real bug avoided: a chosen date
 * column can hold a FUTURE date (a "Due date", a renewal), and a scope ending at
 * `now` would exempt those rows from `retireAbsent` forever — a mirror that can
 * never retire part of itself, drifting from the table it claims to equal, and
 * warning about it (`[mirror-drift]`) on every sweep.
 *
 * These bounds are the whole range a row of ours can carry: `normalizeDateValue`
 * refuses years outside 1900-2100 (normalize-dates' MIN_YEAR/MAX_YEAR), and the
 * other two sources of `occurredAt` — Airtable's `createdTime` and the read
 * moment — are always inside it.
 */
const MIRROR_FROM = new Date("1900-01-01T00:00:00.000Z");
const MIRROR_TO = new Date("2100-12-31T23:59:59.999Z");

/**
 * What a row is dated from when nobody has nominated a column — and it is a
 * REAL field of the record, not a fallback we invented, which is why it is named
 * in `dateFieldState.column` rather than reported as "nothing dated these rows".
 * Saying null there would make the shared note (`dateColumnNote`) tell a user
 * "timing uses when each row was first imported" while `occurred_at` actually
 * holds Airtable's own creation time.
 */
const CREATED_TIME = "createdTime";

const api = (c?: Record<string, unknown> | null) => bearerClient(API, requireCredential(c, "apiKey", "Airtable"), "Airtable");

/** An email-shaped string, one level deep — a collaborator cell is `{ id, email, name }`. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailOf(v: unknown): string | null {
  if (typeof v === "string") return EMAIL.test(v.trim()) ? v.trim() : null;
  if (Array.isArray(v)) return v.length > 0 ? emailOf(v[0]) : null;
  if (v && typeof v === "object") return emailOf(asObject(v)["email"]);
  return null;
}
function subjectOf(fields: Record<string, unknown>): string | null {
  for (const v of Object.values(fields)) {
    const email = emailOf(v);
    if (email) return email;
  }
  return null;
}

/**
 * `value` is claimed only from a column that NAMES itself as one.
 *
 * "The first numeric field" is the tempting version and it is a silent wrong
 * answer waiting to happen: a table's first number is as likely to be a score,
 * a headcount or a rating as it is to be money, and a "sum of value" metric
 * built on it would be confidently meaningless. Under-claiming costs a user one
 * Filter step over `properties`; over-claiming costs them a number they believe.
 */
const VALUE_NAME = /(amount|value|total|price|revenue|cost|payment|fee|mrr|arr)/i;
function valueOf(fields: Record<string, unknown>): number | null {
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "number" && Number.isFinite(v) && VALUE_NAME.test(k)) return v;
  }
  return null;
}

type TableRead = {
  records: CanonicalEvent[];
  dateFieldState: NonNullable<PollResult["dateFieldState"]>;
  undatedEventIds: Set<string>;
  /** Requests made, whether or not they returned rows. */
  pages: number;
  /** The continuation the walk stopped holding, or null when the table was fully read. */
  offset: string | null;
  rateLimit: PollResult["rateLimit"];
};

/**
 * Read the table — the whole table, unless the page cap stops it first.
 *
 * BUDGET IS DELIBERATELY NOT HONOURED HERE. `args.budget.maxCalls` bounds an
 * incremental walk, where stopping early only defers rows to the next sweep. A
 * mirror's read IS its meaning: the runner hands what comes back to
 * `retireAbsent`, so a read cut short by a ledger claim would tombstone every
 * row it did not reach — a budget turning into data loss. The cap above is the
 * ceiling instead, and `providerCalls` reports the real spend so the ledger can
 * settle up afterwards.
 */
async function readTable(args: PollArgs, baseId: string, tableId: string, maxPages: number): Promise<TableRead> {
  const client = api(args.credentials);
  // Record ids repeat across a base and its duplicates, so the stream is part of
  // the dedup key — two tables' "recA" must never be one event.
  const tag = args.streamHash ?? `${baseId}:${tableId}`;
  const readAt = new Date();

  /**
   * THREE answers to "what dates a row", not two.
   *
   * A nominated column is the user's. No column with detection still open (the
   * default, and what every Airtable stream says today — the picker is wired to
   * spreadsheets only) means Airtable's own `createdTime`, which is a genuine
   * per-record timestamp and not a stand-in for one. `detectDateField === false`
   * with no column is the third: somebody answered "use import time", and
   * quietly dating by `createdTime` anyway would be overruling them. Only an
   * explicit `false` counts — `undefined` is a caller that never asked (a direct
   * poll, a fixture), which must not read as an answer.
   */
  const chosen = args.dateField ?? null;
  const importTime = chosen == null && args.detectDateField === false;

  const records: CanonicalEvent[] = [];
  const undated = new Set<string>();
  let dated = 0;
  let presentInHeader = false;
  let offset: string | null = null;
  let pages = 0;
  let lastRequestAt = 0;

  do {
    if (pages > 0) {
      const wait = AIRTABLE_PAGING.minGapMs - (Date.now() - lastRequestAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    lastRequestAt = Date.now();
    const page: { records?: unknown[]; offset?: string } = await client.get(
      `/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}`,
      { pageSize: PAGE_SIZE, offset: offset ?? undefined },
    );
    pages += 1;
    for (const raw of (page.records ?? []).map(asObject)) {
      const id = str(raw["id"]);
      if (!id) continue;
      const fields = asObject(raw["fields"]);
      const evId = eventId("airtable", args.connectionId, tag, id);
      const createdTime = str(raw["createdTime"]);

      let occurredAt: Date | null;
      if (chosen != null) {
        // `presentInHeader` is the renamed/removed-column case, which reads
        // identically to "the values are not dates" in the counts alone and
        // needs a different fix. A field absent from EVERY record is the only
        // evidence Airtable gives us: an empty cell is simply omitted from
        // `fields`, so one row proving the column exists is what we look for.
        if (chosen in fields) presentInHeader = true;
        // Parsed by the same conservative canonicaliser the sheet uses, with the
        // FIELD NAME passed, so a numeric column called "Ref" is not read as an
        // epoch while one called "Created" is. Nominating a column says WHICH
        // column, never "reinterpret values the detector would refuse".
        const canonical = normalizeDateValue(fields[chosen], chosen);
        const ms = canonical ? Date.parse(canonical) : NaN;
        occurredAt = Number.isFinite(ms) ? new Date(ms) : null;
      } else if (importTime) {
        occurredAt = null;
      } else {
        occurredAt = parseDate(createdTime, CREATED_TIME);
      }

      if (occurredAt) dated += 1;
      else undated.add(evId);

      records.push({
        eventId: evId,
        eventType: "row_added",
        subject: subjectOf(fields),
        /**
         * The read moment for a row nothing dated — never `createdTime` as a
         * silent second choice. The runner replaces exactly these ids with the
         * row's first-seen time (`restampRecords`), and the note it shows says
         * they "fall back to when they were first imported"; dating them from
         * another column while counting them as undated would make both
         * statements false.
         */
        occurredAt: occurredAt ?? readAt,
        value: valueOf(fields),
        // The cells as the user named them, plus what Airtable knows about the
        // record. `_airtable` is written AFTER the spread on purpose: a table
        // with a column of that name loses it here rather than shadowing the
        // record's own identity, which the field picker hides and nothing else
        // could reconstruct.
        properties: { ...fields, _airtable: { id, createdTime, baseId, tableId } },
      });
    }
    offset = str(page.offset);
  } while (offset && pages < maxPages);

  return {
    records,
    dateFieldState:
      chosen != null
        ? { column: chosen, source: "user", presentInHeader, dated, undated: undated.size }
        : importTime
          ? { column: null, source: "user", presentInHeader: false, dated, undated: undated.size }
          : { column: CREATED_TIME, source: "detected", presentInHeader: true, dated, undated: undated.size },
    undatedEventIds: undated,
    pages,
    offset,
    rateLimit: client.rateLimit() ?? undefined,
  };
}

export const airtableConnector: Connector = {
  source: "airtable",
  authType: "apiKey",
  operations: ["records.list"] as const,
  operationFor: () => "records.list",

  /**
   * FAILS CLOSED, and here that is the whole implementation: this source has no
   * inbound path at all in this batch (see the module comment's webhook
   * deferral), so there is no delivery that could ever be authentic. The webhook
   * route still reaches this before its stream-scoped doorbell bail, which is
   * exactly the hole Sheets had: a `true` here would turn
   * `POST /api/webhooks/<connection-id>` into an anonymous "sweep this
   * connection now" primitive against a 5-request-per-second budget.
   */
  verifySignature(): boolean {
    return false;
  },

  // NO `normalize`. Nothing can reach it — see verifySignature. When the
  // ping-then-fetch path is built, it reads `PollArgs.dateField` the way the
  // poll below does rather than inventing a second answer for one source.

  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key === "baseId") {
      const res = await api(args.credentials).get<{ bases?: unknown[] }>("/meta/bases");
      return (res.bases ?? [])
        .map(asObject)
        .map((b) => ({ value: str(b["id"]) ?? "", label: str(b["name"]) ?? str(b["id"]) ?? "Untitled base" }))
        .filter((o) => o.value);
    }
    if (key === "tableId") {
      // Gated rather than guessed: the tables endpoint is base-scoped, so with
      // no base chosen there is nothing to list — and a request without one
      // would spend a call to learn that.
      const baseId = str(args.config?.["baseId"]);
      if (!baseId) return [];
      const res = await api(args.credentials).get<{ tables?: unknown[] }>(`/meta/bases/${encodeURIComponent(baseId)}/tables`);
      return (res.tables ?? [])
        .map(asObject)
        .map((t) => ({ value: str(t["id"]) ?? "", label: str(t["name"]) ?? str(t["id"]) ?? "Untitled table" }))
        .filter((o) => o.value);
    }
    return [];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const baseId = str(args.config?.["baseId"]);
    const tableId = str(args.config?.["tableId"]);
    if (!baseId || !tableId) return { records: [], nextCursor: null };

    const read = await readTable(args, baseId, tableId, AIRTABLE_PAGING.maxPages);
    if (read.offset) {
      /**
       * Said out loud, because the consequence is not visible from the numbers.
       * `syncStream`'s mirror branch calls `retireAbsent` with whatever scope
       * this poll declares, and an ABSENT scope means "retire everything this
       * read did not produce" — so a truncated read cannot protect its own tail
       * by staying silent. What protects it is the cap sitting above real
       * tables, plus the fact that a row returning to the read revives (the
       * upsert clears `deleted_at`). A table that trips this every sweep needs
       * the paging work, and this line is how anyone finds out.
       */
      console.warn(
        `[airtable-truncated] connection=${args.connectionId} base=${baseId} table=${tableId} pages=${read.pages} — ` +
          `the table is larger than ${AIRTABLE_PAGING.maxPages * PAGE_SIZE} records; rows beyond it are not mirrored.`,
      );
    }
    return {
      records: read.records,
      // A mirror has no resume point: the next poll re-reads the table from the
      // first page. Null is exactly that — "start over" (PollResult.nextCursor).
      nextCursor: null,
      // Declared ONLY when the walk actually finished. `mirrorScope` is the
      // claim "this read is complete for this span", and a prefix of a table is
      // not complete for anything.
      ...(read.offset == null ? { mirrorScope: { from: MIRROR_FROM, to: MIRROR_TO } } : {}),
      incomplete: read.offset != null,
      providerCalls: read.pages,
      rateLimit: read.rateLimit,
      dateFieldState: read.dateFieldState,
      undatedEventIds: read.undatedEventIds,
    };
  },

  /**
   * ONE page for the connect-time preview, sorted newest first by whatever dates
   * these rows. Airtable returns records in the table's own order, so the last
   * page is not "the latest" — reading fifty pages to find out would spend a
   * table's whole budget on a preview.
   */
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const baseId = str(args.config?.["baseId"]);
    const tableId = str(args.config?.["tableId"]);
    if (!baseId || !tableId) return [];
    const read = await readTable(args, baseId, tableId, 1);
    return [...read.records].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, n);
  },
};
