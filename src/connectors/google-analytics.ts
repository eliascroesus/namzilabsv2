import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { fetchJson } from "@/lib/http-client";
import { str } from "./field-utils";
import { createHash } from "node:crypto";

/**
 * GOOGLE ANALYTICS 4, VIA THE DATA API v1.
 *
 * Universal Analytics is gone — standard properties stopped processing hits on
 * 1 Jul 2023, 360 on 1 Jul 2024, and the API and data were switched off the
 * week after. There is no UA fallback here on purpose, and nothing in the UI
 * accepts a `UA-XXXXX-Y` id.
 *
 * TWO APIS, ONE SCOPE. Reporting is `analyticsdata.googleapis.com` (runReport);
 * discovery — "which properties can this person read?" — is the Admin API's
 * `accountSummaries.list`. Both are covered by
 * `https://www.googleapis.com/auth/analytics.readonly`, which is why the
 * consent screen gains exactly one scope.
 *
 * ═══ THIS CONNECTOR HAS NO CURSOR, AND THAT IS NOT AN OVERSIGHT ═══
 *
 * The Data API is an aggregation engine over a mutable warehouse, not an event
 * log. There is no sync token, no webhook, no `updatedAt`, and no id: a row
 * does not exist until you ask for it — it is the output of a GROUP BY that the
 * flow's own config defines. So the only sync mechanism is a date-windowed
 * re-read, and correctness rests entirely on the row identity below.
 *
 * ═══ THE ROW IDENTITY, WHICH IS THE WHOLE DESIGN ═══
 *
 * `eventId` is a hash of (connection, stream, property, report shape, date,
 * every other dimension value). It is a pure function of WHAT the row is and
 * never of what it is worth, so re-reading 1 September produces the same id
 * with updated metric values and the store UPDATES instead of duplicating.
 * That is what makes the trailing re-read safe rather than a slow leak.
 *
 * Four rules keep that hash honest, and each of them is a real collision:
 *   1. THE REPORT SHAPE IS IN THE KEY. Two flows over one property and one day
 *      — `date x channel` and `date x country` — are different facts that would
 *      otherwise collide on (property, date) and overwrite each other with
 *      differently-grouped numbers.
 *   2. JOINED WITH A BYTE THAT CANNOT APPEAR IN A VALUE. Channel names contain
 *      spaces and page paths contain nearly everything, so joining on `:` makes
 *      `["a:b","c"]` and `["a","b:c"]` hash identically. A unit separator can
 *      appear in neither.
 *   3. ZIPPED BY HEADER, NOT BY REQUEST ORDER. The response carries its own
 *      `dimensionHeaders`; assuming the order we asked for is the order we got
 *      would silently transpose two dimensions of the same cardinality.
 *   4. `(not set)` AND `(other)` ARE REAL VALUES. Normalising them away merges
 *      genuinely different rows.
 *
 * ═══ FRESHNESS: TODAY IS NEVER FINAL ═══
 *
 * Standard properties lag 2–6 hours intraday and daily tables settle 12–24h
 * after the day closes, in the PROPERTY'S timezone — which the response tells
 * us (`metadata.timeZone`) and which this connector reads rather than assumes.
 * Parse a `date` dimension as UTC and every row lands on the wrong day for half
 * the world.
 */

const REPORT_OP = "properties.runReport";
const SUMMARIES_OP = "accountSummaries.list";

const DATA_API = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";

/** The API's own ceiling is 250,000; this is one page's worth. */
const PAGE = 10_000;
/** Same shape as every other connector here: bound the walk, not the data. */
const MAX_PAGES = 8;

/**
 * HOW FAR BACK EVERY SWEEP RE-READS.
 *
 * NOT a documented Google figure — they publish that recent data changes, not
 * for how long. Seven days is an engineering judgement with the reasoning
 * written down so it can be argued with: the 24–48h processing window, plus
 * margin for late-arriving app and offline hits. Conversions reassign
 * attribution credit for considerably longer, which is a known limitation
 * rather than something this window quietly covers.
 */
const TRAILING_DAYS = 7;

/** `20260901` → a Date at midnight in the property's own timezone. */
function parseGaDate(yyyymmdd: string, timeZone: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(yyyymmdd);
  if (!m) return null;
  const [, y, mo, d] = m;
  /**
   * Built by asking what UTC instant is displayed as this wall-clock date in
   * that zone, rather than by adding a fixed offset — the offset is not fixed,
   * it moves twice a year, and a property in Europe/Stockholm would drift an
   * hour every spring with the naive arithmetic.
   */
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
    const part = fmt.formatToParts(new Date(guess)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const off = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
    if (!off) return new Date(guess);
    const mins = (Number(off[2]) * 60 + Number(off[3])) * (off[1] === "-" ? -1 : 1);
    return new Date(guess - mins * 60_000);
  } catch {
    // An unrecognised zone must not lose the row; UTC midnight is a defensible
    // fallback and the only alternative is dropping data over a string.
    return new Date(guess);
  }
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

type ReportRow = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };
type ReportResponse = {
  dimensionHeaders?: Array<{ name?: string }>;
  metricHeaders?: Array<{ name?: string; type?: string }>;
  rows?: ReportRow[];
  rowCount?: number;
  metadata?: { timeZone?: string; currencyCode?: string; dataLossFromOtherRow?: boolean; subjectToThresholding?: boolean };
  propertyQuota?: Record<string, { consumed?: number; remaining?: number }>;
};

/**
 * The dimensions a flow groups by, and the metrics it reads. Defaults chosen to
 * be the report almost everyone wants first — sessions and users by day and by
 * channel — and every one of them is overridable from the flow's config.
 */
const DEFAULT_DIMENSIONS = ["date", "sessionDefaultChannelGroup"];
const DEFAULT_METRICS = ["sessions", "engagedSessions", "totalUsers", "screenPageViews", "conversions"];

const list = (v: unknown, fallback: string[]): string[] => {
  if (Array.isArray(v)) {
    const clean = v.map((x) => str(x)).filter((x): x is string => !!x);
    if (clean.length > 0) return clean;
  }
  const s = str(v);
  if (s) {
    const clean = s.split(",").map((x) => x.trim()).filter(Boolean);
    if (clean.length > 0) return clean;
  }
  return fallback;
};

export const googleAnalyticsConnector: Connector = {
  source: "ganalytics",
  authType: "oauth2",
  operations: [REPORT_OP, SUMMARIES_OP] as const,
  operationFor: () => REPORT_OP,
  listOperationFor: (key: string) => (key === "propertyId" ? SUMMARIES_OP : undefined),

  // Read-only reporting; GA4 has no outbound webhook for report data.
  verifySignature(_args: VerifyArgs): boolean {
    return false;
  },

  normalize(_rawPayload: unknown, _ctx: NormalizeContext): CanonicalEvent[] {
    return [];
  },

  async poll(args: PollArgs): Promise<PollResult> {
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("ganalytics: missing access token");

    /**
     * Stored as the full `properties/123456789` string, which is exactly the
     * path parameter runReport wants — discovery hands over the Data API's own
     * address, so there is no concatenation to get wrong.
     */
    const property = str(args.config?.["propertyId"]);
    if (!property) throw new Error("ganalytics: no property selected");
    const propertyPath = property.startsWith("properties/") ? property : `properties/${property}`;

    const dimensions = list(args.config?.["dimensions"], DEFAULT_DIMENSIONS);
    const metrics = list(args.config?.["metrics"], DEFAULT_METRICS);

    /**
     * THE WINDOW, AND WHY ITS FLOOR IS DECLARED TWICE.
     *
     * `types.ts` is explicit that a connector honouring `windowFloor` must use
     * the SAME value for the request bound and for the retirement it declares,
     * or a deepened import gets retired by the next sweep. This connector is
     * the shape that hits that hardest, because its window IS its only sync
     * mechanism: `from` below is the one value, spent in both places.
     */
    const now = new Date();
    const floor = args.windowFloor ?? null;
    const trailing = new Date(now.getTime() - TRAILING_DAYS * 86_400_000);
    const from = floor && floor < trailing ? floor : trailing;

    const records: CanonicalEvent[] = [];
    let providerCalls = 0;
    let offset = 0;
    let timeZone = "UTC";
    let currency: string | null = null;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page++) {
      const body = {
        dateRanges: [{ startDate: iso(from), endDate: iso(now) }],
        dimensions: dimensions.map((name) => ({ name })),
        metrics: metrics.map((name) => ({ name })),
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
        limit: PAGE,
        offset,
        keepEmptyRows: false,
        // The only real measurement of what a call cost. Token price is not
        // per-request — it scales with rows, cardinality and range — so any
        // static budget is a guess and this is the number to back off on.
        returnPropertyQuota: true,
      };

      const data = await fetchJson<ReportResponse>(`${DATA_API}/${propertyPath}:runReport`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      providerCalls++;

      timeZone = data.metadata?.timeZone ?? timeZone;
      currency = data.metadata?.currencyCode ?? currency;

      /**
       * THE EVIDENCE FOR WHEN A CUSTOMER SAYS THE NUMBERS ARE WRONG.
       *
       * Thresholding withholds rows on small audiences, `(other)` rolls up high
       * cardinality, and sampling estimates. All three make this disagree with
       * the GA UI for reasons that are Google's, not ours, and none of them is
       * visible in the rows themselves. Logged rather than silently dropped.
       */
      if (data.metadata?.subjectToThresholding || data.metadata?.dataLossFromOtherRow) {
        console.log(
          `[ganalytics] ${propertyPath} thresholded=${!!data.metadata?.subjectToThresholding} ` +
            `otherRow=${!!data.metadata?.dataLossFromOtherRow} — these numbers will not match the GA UI exactly`,
        );
      }

      const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name ?? "");
      const metHeaders = (data.metricHeaders ?? []).map((h) => h.name ?? "");
      const dateIdx = dimHeaders.indexOf("date");

      for (const row of data.rows ?? []) {
        const dims = (row.dimensionValues ?? []).map((v) => v.value ?? "");
        const mets = (row.metricValues ?? []).map((v) => v.value ?? "");

        const rawDate = dateIdx >= 0 ? dims[dateIdx] : null;
        const occurredAt = rawDate ? parseGaDate(rawDate, timeZone) : null;
        // A report with no `date` dimension has no honest place on a timeline;
        // the flow's own window is the only date it could carry, and stamping
        // every row with "now" would make yesterday's data arrive today.
        if (!occurredAt) continue;

        const properties: Record<string, unknown> = {};
        dimHeaders.forEach((name, i) => {
          if (name && name !== "date") properties[name] = dims[i] ?? "";
        });
        metHeaders.forEach((name, i) => {
          // Every metric value arrives as a STRING, integers included.
          const n = Number(mets[i]);
          if (name) properties[name] = Number.isFinite(n) ? n : null;
        });
        properties["propertyId"] = propertyPath;
        properties["timeZone"] = timeZone;

        /**
         * The report's SHAPE, so two differently-grouped flows over one
         * property and day cannot overwrite each other.
         */
        const shape = createHash("sha256").update([...dimensions].sort().join(",") + "|" + [...metrics].sort().join(",")).digest("hex").slice(0, 8);
        const tuple = dimHeaders.map((_, i) => dims[i] ?? "");
        const eventId =
          "ga4:" +
          createHash("sha256")
            // U+001F: a unit separator cannot occur in a dimension value, which
            // a comma or a colon absolutely can.
            .update([args.streamHash ?? "", propertyPath, shape, ...tuple].join(""))
            .digest("hex")
            .slice(0, 32);

        records.push({
          eventId,
          eventType: "ga4.report.row",
          subject: tuple.filter((_, i) => i !== dateIdx).join(" · ") || propertyPath,
          occurredAt,
          value: typeof properties[metrics[0]] === "number" ? (properties[metrics[0]] as number) : null,
          currency,
          properties,
        });
      }

      const total = data.rowCount ?? records.length;
      offset += PAGE;
      if (offset >= total) {
        /**
         * THE WINDOW WAS READ END TO END, so a row inside it that this read did
         * not return is genuinely gone — traffic fell to zero, or thresholding
         * withdrew it. Declaring the span lets those be retired rather than
         * left stale at their last value, which is the failure the Calendar
         * connector paid for with a customer's acceptance rate.
         *
         * Scoped to the window: history older than `from` is never touched.
         */
        return {
          records,
          nextCursor: null,
          providerCalls,
          retireOutsideWindow: { from, to: now },
          mirrorScope: { from, to: now },
        };
      }
      truncated = true;
    }

    // A prefix of the window is not the window: retiring against it would
    // tombstone every row past the last page reached.
    console.log(`[ganalytics] ${propertyPath} page budget spent after ${MAX_PAGES} pages, ${records.length} rows — window not fully read`);
    return { records, nextCursor: null, providerCalls, incomplete: truncated };
  },

  /**
   * WHICH PROPERTIES THIS PERSON CAN READ.
   *
   * `accountSummaries` returns only what the authenticated user has access to,
   * so there is no permission filtering to do here — and a user with no GA
   * access gets an empty list rather than an error, which is "nothing to
   * connect", not a failure.
   */
  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "propertyId") return [];
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("ganalytics: missing access token");

    const out: SourceOption[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${ADMIN_API}/accountSummaries`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await fetchJson<{
        accountSummaries?: Array<{
          displayName?: string;
          propertySummaries?: Array<{ property?: string; displayName?: string; propertyType?: string }>;
        }>;
        nextPageToken?: string;
      }>(url.toString(), { headers: { authorization: `Bearer ${token}` } });

      for (const acct of data.accountSummaries ?? []) {
        for (const p of acct.propertySummaries ?? []) {
          if (!p.property) continue;
          // The account name is carried into the label because one person's
          // "Website" can exist under three accounts.
          const label = acct.displayName ? `${p.displayName ?? p.property} — ${acct.displayName}` : (p.displayName ?? p.property);
          out.push({ value: p.property, label });
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return out;
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null });
    return records.slice(0, n);
  },
};
