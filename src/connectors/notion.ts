import type {
  CanonicalEvent,
  Connector,
  ListOptionsArgs,
  PollArgs,
  PollResult,
  SourceOption,
} from "./types";
import { asObject, str } from "./field-utils";
import { bearerClient, eventId, parseDate, requireCredential } from "./kit";
import { normalizeDateValue } from "@/lib/normalize-dates";

/**
 * Notion — the rows of one database, mirrored.
 *
 * EVERY FACT BELOW WAS READ OFF NOTION'S OWN DOCS on 19 Sep 2026; the catalog
 * entry cites the pages. Sources:
 *  - Fundamentals, auth, pagination: developers.notion.com/reference/intro
 *  - Authorization: developers.notion.com/docs/authorization
 *  - Query a data source: developers.notion.com/reference/query-a-data-source
 *  - Search: developers.notion.com/reference/post-search
 *  - Limits: developers.notion.com/reference/request-limits
 *
 * WHAT A RECORD IS, AND WHY IT IS NOT "A PAGE". Notion holds documents, and a
 * document is not a measurement. What a metrics product can count honestly is a
 * DATABASE ROW: rows carry typed properties — dates, numbers, people, selects —
 * so "revenue by month" is arithmetic over real fields rather than over prose.
 * Free-form pages and blocks are deliberately out of scope; the stream is one
 * data source, chosen per flow, exactly as Airtable's is one table.
 */

const API = "https://api.notion.com/v1";

/**
 * The Notion API version this connector is written against, sent on EVERY
 * request as `Notion-Version`.
 *
 * NOTION REQUIRES THIS HEADER, which is the good case — there is no "unpinned"
 * state to drift in, unlike Whop, where an omitted version silently rode the
 * newest release and broke this codebase twice (see WHOP_API_VERSION). Here the
 * only failure mode is pinning to a version whose shapes we have not read.
 *
 * WHY THIS VALUE. `2025-09-03` is the release that split databases into DATA
 * SOURCES, and it is the floor for everything this connector does:
 * `POST /v1/data_sources/{id}/query` replaced `POST /v1/databases/{id}/query`,
 * and `filter: { property: "object", value: "data_source" }` on search only
 * exists from here. Pinning EARLIER is not merely stale — Notion states that a
 * pre-2025-09-03 integration starts FAILING outright the moment a user adds a
 * second data source to a database, because the old database-shaped calls can
 * no longer name which source they meant.
 *
 * Later versions exist (the reference showed `2026-03-11`). Moving to one is a
 * deliberate act: read its upgrade guide, then re-run `scripts/verify-notion.ts`.
 */
export const NOTION_API_VERSION = "2025-09-03";

/** Notion's maximum `page_size` for paginated endpoints (reference/intro). */
const PAGE_SIZE = 100;

/**
 * How much of a data source a mirror will read, and the pacing it reads at.
 *
 * `maxPages` × PAGE_SIZE is the ceiling — 5,000 rows, the same cap Airtable
 * documents, and stated in the catalog's `syncNote` so it is visible in the
 * product rather than discovered.
 *
 * `minGapMs` keeps a page walk under Notion's own floor. The published limit is
 * 180 requests per minute — "an average of 3 per second" — for every plan below
 * Business/Enterprise, so 350ms between pages is the conservative reading of
 * the number most customers actually have.
 */
const NOTION_PAGING = { maxPages: 50, minGapMs: 350 };

/**
 * The span a COMPLETE read declares itself complete for.
 *
 * Copied from Airtable deliberately, including the reasoning: a chosen date
 * property can hold a FUTURE date (a renewal, a due date), and a scope ending at
 * `now` would exempt those rows from `retireAbsent` for ever — a mirror that can
 * never retire part of itself. These bounds are the whole range a row of ours
 * can carry, since `normalizeDateValue` refuses years outside 1900-2100.
 */
const MIRROR_FROM = new Date("1900-01-01T00:00:00.000Z");
const MIRROR_TO = new Date("2100-12-31T23:59:59.999Z");

/**
 * What dates a row when nobody has nominated a property — and it is a REAL
 * field of the record, Notion's own `created_time`, not a fallback we invented.
 * Named in `dateFieldState.column` for the same reason Airtable names its one:
 * saying null there would tell the user "timing uses when each row was first
 * imported" while `occurred_at` actually held Notion's creation time.
 */
const CREATED_TIME = "created_time";

const api = (c?: Record<string, unknown> | null) =>
  bearerClient(API, requireCredential(c, "apiKey", "Notion"), "Notion", { "Notion-Version": NOTION_API_VERSION });

/** Join Notion's rich-text array into the text a human sees. */
function richText(v: unknown): string | null {
  if (!Array.isArray(v)) return null;
  const text = v
    .map((n) => str(asObject(n)["plain_text"]) ?? "")
    .join("")
    .trim();
  return text === "" ? null : text;
}

/**
 * ONE NOTION PROPERTY, AS A PLAIN VALUE — the piece with no Airtable analogue.
 *
 * Airtable hands back cells that are already primitives. Notion hands back a
 * tagged union: `{ type: "number", number: 42 }`, `{ type: "date", date: { start
 * } }`, `{ type: "select", select: { name } }`. Storing those envelopes verbatim
 * would put `{"type":"select","select":{"id":"…","color":"blue","name":"Won"}}`
 * in front of somebody building a filter, so each type is unwrapped to the value
 * a person would say out loud.
 *
 * Unknown and structural types return null rather than a guess: `button`,
 * `verification` and friends have no scalar meaning, and inventing one would put
 * a number in a chart that nothing in Notion agrees with. The raw property is
 * still kept under `_notion.properties` for anything that needs the envelope.
 */
function plain(prop: unknown): unknown {
  const p = asObject(prop);
  const type = str(p["type"]);
  if (!type) return null;
  switch (type) {
    case "title":
    case "rich_text":
      return richText(p[type]);
    case "number":
      return typeof p["number"] === "number" ? p["number"] : null;
    case "checkbox":
      return typeof p["checkbox"] === "boolean" ? p["checkbox"] : null;
    case "url":
    case "email":
    case "phone_number":
      return str(p[type]);
    case "select":
    case "status":
      return str(asObject(p[type])["name"]);
    case "multi_select":
      return Array.isArray(p["multi_select"])
        ? p["multi_select"].map((o) => str(asObject(o)["name"])).filter((n): n is string => !!n)
        : null;
    case "date":
      // The START is the date a row happened on; `end` is a range's far side and
      // belongs in properties, not in `occurredAt`.
      return str(asObject(p["date"])["start"]);
    case "created_time":
    case "last_edited_time":
      return str(p[type]);
    case "people":
      return Array.isArray(p["people"])
        ? p["people"].map((u) => str(asObject(u)["name"]) ?? str(asObject(u)["id"]) ?? "").filter(Boolean)
        : null;
    case "created_by":
    case "last_edited_by":
      return str(asObject(p[type])["name"]) ?? str(asObject(p[type])["id"]);
    case "unique_id": {
      const u = asObject(p["unique_id"]);
      const prefix = str(u["prefix"]);
      const num = typeof u["number"] === "number" ? u["number"] : null;
      return num == null ? null : prefix ? `${prefix}-${num}` : num;
    }
    case "formula": {
      // A formula carries its own inner type — recursing is what makes a
      // computed revenue column count as the number it displays.
      const f = asObject(p["formula"]);
      return plain({ ...f, type: str(f["type"]) });
    }
    case "rollup": {
      const r = asObject(p["rollup"]);
      const rt = str(r["type"]);
      if (rt === "number" || rt === "date") return plain({ ...r, type: rt });
      return null;
    }
    case "relation":
      return Array.isArray(p["relation"]) ? p["relation"].map((x) => str(asObject(x)["id"])).filter(Boolean) : null;
    default:
      return null;
  }
}

/** A property's type, for picking date candidates and the value column. */
function typeOf(prop: unknown): string {
  return str(asObject(prop)["type"]) ?? "";
}

const DATE_TYPES = new Set(["date", "created_time", "last_edited_time"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who or what a row is about: its title, else an email, else nothing. */
function subjectOf(flat: Record<string, unknown>, props: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(props)) {
    if (typeOf(v) === "title") {
      const t = flat[k];
      if (typeof t === "string" && t.trim()) return t.trim();
    }
  }
  for (const v of Object.values(flat)) {
    if (typeof v === "string" && EMAIL.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * What a row is WORTH, when a column plainly says so.
 *
 * Name-matched like Airtable's, and for the same reason: Notion's types say a
 * property holds a number, never that the number is money. A row id, a headcount
 * and a sort order are all numbers, and summing the first one a table happens to
 * declare would produce a total that means nothing.
 */
const VALUE_NAME = /(amount|value|total|price|revenue|cost|payment|fee|mrr|arr)/i;
function valueOf(flat: Record<string, unknown>, props: Record<string, unknown>): number | null {
  for (const [k, v] of Object.entries(props)) {
    const t = typeOf(v);
    if (t !== "number" && t !== "formula" && t !== "rollup") continue;
    if (!VALUE_NAME.test(k)) continue;
    const n = flat[k];
    if (typeof n === "number" && Number.isFinite(n)) return n;
  }
  return null;
}

/** The human name of a data source or page object returned by search. */
function titleOf(o: Record<string, unknown>): string | null {
  return richText(o["title"]) ?? str(o["name"]);
}

type SourceRead = {
  records: CanonicalEvent[];
  dateFieldState: NonNullable<PollResult["dateFieldState"]>;
  undatedEventIds: Set<string>;
  pages: number;
  /** The cursor the walk stopped holding, or null when the source was fully read. */
  cursor: string | null;
  rateLimit: PollResult["rateLimit"];
};

/**
 * Read the data source — all of it, unless the page cap stops it first.
 *
 * BUDGET IS DELIBERATELY NOT HONOURED HERE, exactly as in Airtable: a mirror's
 * read IS its meaning, because the runner hands what comes back to
 * `retireAbsent`. A read cut short by a ledger claim would tombstone every row
 * it never reached — a budget turning into data loss. The cap is the ceiling
 * instead, and `providerCalls` reports the real spend so the ledger settles up.
 *
 * TRASHED ROWS ARE WHAT MAKE THIS A MIRROR AND NOT A WALK. A query returns live
 * rows only — a page moved to Notion's trash simply stops appearing — so there
 * is no "it was deleted" event to observe anywhere in this API. Absence from a
 * complete read is the only evidence Notion gives, and absence is precisely what
 * `retireAbsent` consumes. An incremental walk on `last_edited_time` would be
 * cheaper and would never see a deletion at all, which is the Google Calendar
 * bug (cancelled meetings counted for ever) waiting to happen again.
 */
async function readDataSource(args: PollArgs, dataSourceId: string, maxPages: number): Promise<SourceRead> {
  const client = api(args.credentials);
  // Page ids are unique across a workspace, but a duplicated database gives two
  // streams rows that mean different things — so the stream is in the dedup key.
  const tag = args.streamHash ?? dataSourceId;
  const readAt = new Date();

  /**
   * THREE answers to "what dates a row", the same three Airtable has. A
   * nominated property is the user's. No property with detection still open
   * means Notion's own `created_time`, a genuine per-record timestamp. An
   * explicit `detectDateField === false` with no column is somebody answering
   * "use import time", and dating by `created_time` anyway would overrule them.
   */
  const chosen = args.dateField ?? null;
  const importTime = chosen == null && args.detectDateField === false;

  const records: CanonicalEvent[] = [];
  const undated = new Set<string>();
  const candidates = new Set<string>();
  let dated = 0;
  let presentInHeader = false;
  let cursor: string | null = null;
  let pages = 0;
  let lastRequestAt = 0;

  do {
    if (pages > 0) {
      const wait = NOTION_PAGING.minGapMs - (Date.now() - lastRequestAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    lastRequestAt = Date.now();
    const page: { results?: unknown[]; next_cursor?: string | null; has_more?: boolean } = await client.post(
      `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
      { page_size: PAGE_SIZE, ...(cursor ? { start_cursor: cursor } : {}) },
    );
    pages += 1;

    for (const raw of (page.results ?? []).map(asObject)) {
      const id = str(raw["id"]);
      if (!id) continue;
      const props = asObject(raw["properties"]);
      const evId = eventId("notion", args.connectionId, tag, id);
      const createdTime = str(raw["created_time"]);

      // Unwrap every property once: both the value logic and what we store read
      // from the same flattened view, so they can never disagree.
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        flat[k] = plain(v);
        if (DATE_TYPES.has(typeOf(v))) candidates.add(k);
      }

      let occurredAt: Date | null;
      if (chosen != null) {
        // A property absent from EVERY row is the renamed-or-removed case, which
        // reads identically to "the values are not dates" in the counts alone.
        // Notion returns every property on every row (empty ones as null), so
        // presence in `properties` is the honest test.
        if (chosen in props) presentInHeader = true;
        // Parsed by the same conservative canonicaliser the sheet and the table
        // use, WITH the property name, so a number called "Ref" is not read as
        // an epoch while one called "Created" is.
        const canonical = normalizeDateValue(flat[chosen], chosen);
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
        subject: subjectOf(flat, props),
        /**
         * The read moment for a row nothing dated — never `created_time` as a
         * silent second choice. The runner replaces exactly these ids with the
         * row's first-seen time (`restampRecords`), and the note it shows says
         * they "fall back to when they were first imported"; dating them from
         * another field while counting them as undated would make both false.
         */
        occurredAt: occurredAt ?? readAt,
        value: valueOf(flat, props),
        /**
         * The properties as the user named them, plus what Notion knows about
         * the page. `_notion` is written AFTER the spread on purpose: a database
         * with a property of that name loses it here rather than shadowing the
         * row's own identity.
         */
        properties: {
          ...flat,
          _notion: {
            id,
            url: str(raw["url"]),
            created_time: createdTime,
            last_edited_time: str(raw["last_edited_time"]),
            dataSourceId,
            properties: props,
          },
        },
      });
    }

    cursor = page.has_more === true ? str(page.next_cursor) : null;
  } while (cursor && pages < maxPages);

  return {
    records,
    dateFieldState:
      chosen != null
        ? { column: chosen, source: "user", presentInHeader, dated, undated: undated.size, candidates: [...candidates] }
        : importTime
          ? { column: null, source: "user", presentInHeader: false, dated, undated: undated.size, candidates: [...candidates] }
          : {
              column: CREATED_TIME,
              source: "detected",
              presentInHeader: true,
              dated,
              undated: undated.size,
              // Notion's properties are TYPED, so unlike a spreadsheet we can
              // offer the real date columns instead of making the user guess.
              candidates: [...candidates],
            },
    undatedEventIds: undated,
    pages,
    cursor,
    rateLimit: client.rateLimit() ?? undefined,
  };
}

export const notionConnector: Connector = {
  source: "notion",
  authType: "apiKey",
  operations: ["api.request"] as const,
  operationFor: () => "api.request",

  /**
   * FAILS CLOSED, and here that is the whole implementation. Notion webhooks
   * exist, but a subscription is created in NOTION'S DASHBOARD rather than over
   * the API, and it is armed by a one-time `verification_token` that the user
   * would have to copy back here — so there is no inbound path in this batch and
   * no delivery that could ever be authentic. Returning `true` would turn
   * `POST /api/webhooks/<connection-id>` into an anonymous "sweep this
   * connection now" primitive against a 3-request-per-second budget, which is
   * the hole Sheets had.
   */
  verifySignature(): boolean {
    return false;
  },

  // NO `normalize`. Nothing can reach it — see verifySignature.

  /**
   * The databases this token can see.
   *
   * Search is the only way to enumerate them: Notion has no "list databases"
   * endpoint, and an integration sees ONLY what a human has explicitly shared
   * with it. An empty list here is therefore the expected first experience, not
   * a failure — it means the connection exists but no database has been added to
   * it yet, which is why the guide's steps end at "add the connection to the
   * database" rather than at pasting the token.
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "dataSourceId") return [];
    const client = api(args.credentials);
    const out: SourceOption[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: { results?: unknown[]; next_cursor?: string | null; has_more?: boolean } = await client.post("/search", {
        filter: { property: "object", value: "data_source" },
        page_size: PAGE_SIZE,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const o of (res.results ?? []).map(asObject)) {
        const value = str(o["id"]);
        if (value) out.push({ value, label: titleOf(o) ?? "Untitled database" });
      }
      pages += 1;
      cursor = res.has_more === true ? str(res.next_cursor) : null;
    } while (cursor && pages < 5);
    return out;
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const dataSourceId = str(args.config?.["dataSourceId"]);
    if (!dataSourceId) return { records: [], nextCursor: null };

    const read = await readDataSource(args, dataSourceId, NOTION_PAGING.maxPages);
    if (read.cursor) {
      /**
       * Said out loud, because the consequence is not visible from the numbers.
       * A truncated read cannot protect its own tail by staying silent — the
       * mirror branch retires whatever this poll does not produce within the
       * scope it declares. What protects it is the cap sitting above real
       * databases, the withheld `mirrorScope` below, and the fact that a row
       * returning to the read revives (the upsert clears `deleted_at`).
       */
      console.warn(
        `[notion-truncated] connection=${args.connectionId} data_source=${dataSourceId} pages=${read.pages} — ` +
          `the database is larger than ${NOTION_PAGING.maxPages * PAGE_SIZE} rows; rows beyond it are not mirrored.`,
      );
    }
    return {
      records: read.records,
      // A mirror has no resume point: the next poll re-reads from the first
      // page. Null is exactly that — "start over" (PollResult.nextCursor).
      nextCursor: null,
      // Declared ONLY when the walk actually finished. `mirrorScope` is the
      // claim "this read is complete for this span", and a prefix of a database
      // is not complete for anything.
      ...(read.cursor == null ? { mirrorScope: { from: MIRROR_FROM, to: MIRROR_TO } } : {}),
      incomplete: read.cursor != null,
      providerCalls: read.pages,
      rateLimit: read.rateLimit,
      dateFieldState: read.dateFieldState,
      undatedEventIds: read.undatedEventIds,
    };
  },

  /**
   * ONE page for the connect-time preview, newest first by whatever dates these
   * rows. Notion returns rows in the data source's own order unless asked
   * otherwise, so the last page is not "the latest" — and reading fifty pages to
   * find out would spend a database's whole budget on a preview.
   */
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const dataSourceId = str(args.config?.["dataSourceId"]);
    if (!dataSourceId) return [];
    const read = await readDataSource(args, dataSourceId, 1);
    return [...read.records].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, n);
  },
};
