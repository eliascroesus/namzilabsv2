/**
 * Automatic date-field detection + canonicalization.
 *
 * Every connector delivers source-specific payloads (`events.properties`), and
 * different apps write dates in different shapes — "7/21/2026 14:23:45" from a
 * sheet, ISO strings from APIs, "Jan 5, 2026" from forms, unix timestamps from
 * webhooks. The engine, the field pickers and the dashboard's time axes all
 * need ONE canonical shape, so ingestion (and the flow read path, which also
 * covers rows stored before this existed) pass properties through this module.
 * The user never cleans up dates by hand.
 *
 * The detector is deliberately conservative: a WHITELIST of unambiguous date
 * shapes, each validated field-by-field (real month/day ranges, sane years),
 * because reformatting a value that isn't a date destroys data. Purely numeric
 * values (unix timestamps, YYYYMMDD) additionally require the FIELD NAME to
 * look date-like — "1750000000" in a field called `revenue` is money, in
 * `created_at` it's a timestamp. Anything not confidently a date passes
 * through untouched.
 *
 * Canonical output:
 *  - date + time → ISO-8601 UTC       "2026-07-21T14:23:45.000Z"
 *  - date only   → "YYYY-MM-DD"       "2026-07-21"
 *
 * Both shapes re-detect as dates, so normalizing is idempotent, and both are
 * recognized by the schema-inference `date` type that powers the field pickers
 * and the metric time-reference dropdown.
 */

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** Month names (full + common abbreviations), 1-based. */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** Field-name tokens that mark a field as date-ish (gates the ambiguous numeric formats). */
const HINT_TOKENS = new Set([
  "date", "dates", "datetime", "time", "times", "timestamp", "ts",
  "at", "on", "when", "day", "dob",
  "created", "updated", "modified", "scheduled", "occurred", "received",
  "sent", "opened", "clicked", "booked", "completed", "canceled", "cancelled",
  "closed", "joined", "signed", "start", "started", "starts", "end", "ended",
  "ends", "due", "deadline", "expires", "expiry", "expiration",
  "birth", "birthday", "anniversary",
]);

/** True when a field name reads as date-ish ("created_at", "bookingDate", "Timestamp"…). */
export function isDateHintedName(name: string): boolean {
  if (!name) return false;
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → words
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((t) => HINT_TOKENS.has(t));
}

type TimeParts = { h: number; m: number; s: number; ms: number };

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:\s?([AaPp])\.?[Mm]\.?)?$/;

function parseTimePart(raw: string): TimeParts | null {
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  const ms = m[4] ? Number(`${m[4]}00`.slice(0, 3)) : 0;
  const ampm = m[5]?.toLowerCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    if (ampm === "p" && h !== 12) h += 12;
    if (ampm === "a" && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  if (min > 59 || s > 59) return null;
  return { h, m: min, s, ms };
}

const ZONE_RE = /\s?(Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i;

function zoneOffsetMinutes(zone: string): number {
  if (/^(Z|GMT|UTC)$/i.test(zone)) return 0;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/** Split an optional "time-and-zone" tail into validated parts. Null = invalid tail. */
function parseTimeAndZone(rest: string | undefined): { time?: TimeParts; offsetMin: number } | null {
  if (rest == null || rest.trim() === "") return { offsetMin: 0 };
  let s = rest.trim();
  let offsetMin = 0;
  const zm = ZONE_RE.exec(s);
  if (zm) {
    offsetMin = zoneOffsetMinutes(zm[1]);
    s = s.slice(0, zm.index).trim();
    if (s === "") return null; // a bare zone with no time is not a date-time
  }
  const time = parseTimePart(s);
  if (!time) return null;
  return { time, offsetMin };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Assemble the canonical string from validated components, or null when the
 * components don't form a real calendar date (Feb 30, month 13, year 2450…).
 * A naive datetime (no zone) is treated as UTC so output is deterministic —
 * never dependent on the server's local timezone.
 */
function build(y: number, mo: number, d: number, time: TimeParts | undefined, offsetMin: number): string | null {
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d, time?.h ?? 0, time?.m ?? 0, time?.s ?? 0, time?.ms ?? 0);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (!time) return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
  return new Date(ms - offsetMin * 60_000).toISOString();
}

// ---- Whitelisted string shapes (anchored full-match; year always required) ----

/** 2026-07-21 / 2026/7/1, optionally with a time ("T" or space) and zone. */
const YMD_RE = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[T ](.+))?$/;
/** 7/21/2026, 21.07.2026, 01-02-2026 — day/month order disambiguated below. */
const DMY_MDY_RE = /^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})(?:[T ](.+))?$/;
/** Same with a 2-digit year — ambiguous enough to require a date-hinted field name. */
const DMY_MDY_SHORT_RE = /^(\d{1,2})([/.\-])(\d{1,2})\2(\d{2})(?:[T ](.+))?$/;
/** 5 Jan 2026 / 05-Jan-2026 / 5th January, 2026 (+ optional time). */
const D_MON_Y_RE = /^(\d{1,2})(?:st|nd|rd|th)?[ \-]([A-Za-z]{3,9})\.?[ \-,]+(\d{4})(?: (.+))?$/;
/** Jan 5, 2026 / January 5 2026 (+ optional time). */
const MON_D_Y_RE = /^([A-Za-z]{3,9})\.?[ ]+(\d{1,2})(?:st|nd|rd|th)?,?[ ]+(\d{4})(?: (.+))?$/;
/** RFC-2822: Tue, 05 Jan 2026 10:00:00 GMT. */
const RFC2822_RE = /^[A-Za-z]{3},?\s+(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})\s+(.+)$/;
/** Compact YYYYMMDD — pure digits, so it requires a date-hinted field name. */
const COMPACT_RE = /^(\d{4})(\d{2})(\d{2})$/;

/** Unix-timestamp windows: seconds ≈ 1998–2100, milliseconds likewise. */
const SEC_MIN = 9e8; // 1998-07-09
const SEC_MAX = 4102444800; // 2100-01-01
const MS_MIN = 9e11;
const MS_MAX = 4102444800000;

function fromEpoch(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  let ms: number | null = null;
  if (n >= MS_MIN && n <= MS_MAX) ms = n;
  else if (n >= SEC_MIN && n <= SEC_MAX) ms = n * 1000;
  if (ms == null) return null;
  return new Date(ms).toISOString();
}

/**
 * Detect one value as a date and return its canonical form, or null when it is
 * not confidently a date. `fieldName` gates the purely-numeric shapes.
 */
export function normalizeDateValue(value: unknown, fieldName = ""): string | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !isDateHintedName(fieldName)) return null;
    return fromEpoch(value);
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length < 6 || s.length > 40 || !/\d/.test(s)) return null;

  // Purely numeric strings (timestamps, YYYYMMDD) need a date-hinted field name.
  if (/^\d+$/.test(s)) {
    if (!isDateHintedName(fieldName)) return null;
    const compact = COMPACT_RE.exec(s);
    if (compact) return build(Number(compact[1]), Number(compact[2]), Number(compact[3]), undefined, 0);
    if (s.length === 10 || s.length === 13) return fromEpoch(Number(s));
    return null;
  }

  let m = YMD_RE.exec(s);
  if (m) {
    const tz = parseTimeAndZone(m[5]);
    if (!tz) return null;
    return build(Number(m[1]), Number(m[3]), Number(m[4]), tz.time, tz.offsetMin);
  }

  m = DMY_MDY_RE.exec(s) ?? (isDateHintedName(fieldName) ? DMY_MDY_SHORT_RE.exec(s) : null);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    let y = Number(m[4]);
    if (y < 100) y = y >= 70 ? 1900 + y : 2000 + y;
    const tz = parseTimeAndZone(m[5]);
    if (!tz) return null;
    // Disambiguation: an impossible month decides the order; otherwise dotted
    // dates read day-first (European "21.07.2026") and slashed/dashed read
    // month-first (US "7/21/2026" — the Sheets default).
    let mo: number, d: number;
    if (a > 12 && b <= 12) [d, mo] = [a, b];
    else if (b > 12 && a <= 12) [mo, d] = [a, b];
    else if (m[2] === ".") [d, mo] = [a, b];
    else [mo, d] = [a, b];
    return build(y, mo, d, tz.time, tz.offsetMin);
  }

  m = D_MON_Y_RE.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    const tz = parseTimeAndZone(m[4]);
    if (!tz) return null;
    return build(Number(m[3]), mo, Number(m[1]), tz.time, tz.offsetMin);
  }

  m = MON_D_Y_RE.exec(s);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    const tz = parseTimeAndZone(m[4]);
    if (!tz) return null;
    return build(Number(m[3]), mo, Number(m[2]), tz.time, tz.offsetMin);
  }

  m = RFC2822_RE.exec(s);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    const tz = parseTimeAndZone(m[4]);
    if (!tz || !tz.time) return null;
    return build(Number(m[3]), mo, Number(m[1]), tz.time, tz.offsetMin);
  }

  return null;
}

const MAX_DEPTH = 4;

function walkValue(v: unknown, key: string, depth: number): unknown {
  if (typeof v === "string" || typeof v === "number") return normalizeDateValue(v, key) ?? v;
  if (v == null || depth >= MAX_DEPTH) return v;
  if (Array.isArray(v)) return v.map((x) => walkValue(x, key, depth + 1));
  if (typeof v === "object") return walkObject(v as Record<string, unknown>, depth + 1);
  return v;
}

function walkObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    // "__"-prefixed keys are internal engine stamps (per-step counts) — never touched.
    out[k] = k.startsWith("__") ? v : walkValue(v, k, depth);
  }
  return out;
}

/**
 * Return a copy of an event's `properties` with every confidently-detected date
 * value rewritten to its canonical form (nested objects/arrays included, to a
 * sane depth). Idempotent; everything else passes through byte-identical.
 */
export function normalizeDatesDeep(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (props == null) return {};
  return walkObject(props, 0);
}

/**
 * Rows read for detection. Deep enough that a column left blank at the top of a
 * sheet still gets judged on real values, bounded so a 50,000-row tab does not
 * pay for the answer on every sweep.
 */
const DETECT_ROWS = 200;
/** Values per column actually parsed. The verdict does not get better after this. */
const DETECT_SAMPLE = 50;
/** Share of a column's non-empty sampled values that must parse for it to qualify. */
const DETECT_THRESHOLD = 0.5;

export type DateColumnDetection = {
  /** The one column to date rows from, or null when there is not exactly one. */
  column: string | null;
  /** Every column that qualified. Length > 1 is the ambiguous case, and the names are the question. */
  candidates: string[];
};

/**
 * Which column of a table-shaped source holds a row's event time.
 *
 * TWO GATES, and the second is the one that matters. A date-hinted NAME is not
 * evidence — "Start", "Closed", "Notes on" all pass `isDateHintedName` and a
 * column called "Closed" may hold "yes"/"no". So a column qualifies only if its
 * actual values parse: name proposes, values decide. That is also why this is
 * not the header-only guess it replaces, which could have nominated a column of
 * free text and dated every row from it.
 *
 * A MAJORITY of non-empty sampled values, not all of them and not one. All of
 * them makes a single typo disqualify the right column; one of them lets a
 * stray "2026 revision" in a notes column qualify the wrong one. Rows that do
 * not parse are still counted and shown by the caller, so an under-parse is
 * visible where an over-parse silently invents dates.
 *
 * SEVERAL QUALIFYING COLUMNS IS NOT A TIE TO BREAK. A sheet with "Booked on"
 * and "Closed on" has two real answers and picking either is a coin toss the
 * user cannot see — so nothing is used and both names are returned for the
 * question. This is the only case where choosing should be anybody's job.
 *
 * Symmetric with `firstEmailLike` in the Sheets connector, which has always
 * scanned the same header row to find a subject. The difference is that a wrong
 * subject is cosmetic and a wrong date moves every number on the dashboard,
 * which is why this one validates and that one does not.
 */
/**
 * Does this named field hold dates? The two gates, shared by every caller.
 *
 * Exported so a sheet column and a webhook key are judged by ONE rule. They
 * differ in how the values are gathered and in how ties are broken; they must
 * not differ in what counts as a date, because that is the disagreement that
 * makes a number depend on which door the data came through.
 */
export function qualifiesAsDateField(name: string, values: Iterable<unknown>): boolean {
  if (name.trim() === "" || !isDateHintedName(name)) return false;
  let seen = 0;
  let parsed = 0;
  for (const value of values) {
    if (value == null || String(value).trim() === "") continue;
    seen += 1;
    if (normalizeDateValue(value, name) != null) parsed += 1;
    if (seen >= DETECT_SAMPLE) break;
  }
  // No values at all is not a qualification: an empty field is not the date
  // field, and a source with names and no rows has nothing to detect from.
  return seen > 0 && parsed / seen > DETECT_THRESHOLD;
}

export function detectDateColumn(
  headers: readonly unknown[],
  rows: readonly (readonly unknown[])[],
): DateColumnDetection {
  const sample = rows.slice(0, DETECT_ROWS);
  const candidates = headers
    .map((raw, index) => ({ name: String(raw ?? "").trim(), index }))
    .filter(({ name, index }) => qualifiesAsDateField(name, sample.map((row) => row?.[index])))
    .map(({ name }) => name);
  return { column: candidates.length === 1 ? candidates[0] : null, candidates };
}

/**
 * WHICH KEY OF AN ARBITRARY JSON PAYLOAD HOLDS THE EVENT TIME.
 *
 * Same two gates as a sheet column — a date-hinted name, and values that
 * actually parse — and a different tie-break, for a reason that is about the
 * data rather than about convenience.
 *
 * A sheet's column names are invented by whoever made the sheet, so "Booked on"
 * and "Closed on" are equally plausible and choosing between them is the user's
 * job. A webhook payload's keys are CONVENTIONAL: `occurred_at` means the thing
 * happened then, and `updated_at` means a record was touched then. Those are not
 * equally good answers to "when did this happen", and treating them as a tie
 * would leave every ordinary payload permanently ambiguous — auto-detect that
 * never fires is the broken-by-default state with extra steps.
 *
 * THREE TIERS, and the middle one is why a flat list will not do. `updated_at`
 * parses cleanly and reads as date-hinted, so on a flat list it wins as often as
 * anything else — and it is the one key guaranteed to move under you, because a
 * record edited today would re-date an event from March.
 *
 *   1 EVENT     when the thing happened
 *   2 CREATION  when the record was made — a good proxy
 *   3 MUTATION  when the record last changed — a bad proxy, and never a silent one
 *
 * A lower tier NEVER beats a higher one, whatever the payload contains. Within a
 * tier, ties are the user's to break, exactly as they are for a sheet.
 *
 * A MUTATION KEY IS RETURNED BUT FLAGGED. Refusing it outright would leave a
 * payload that genuinely only carries `updated_at` on delivery time forever with
 * no way forward; using it quietly would put a moving timestamp behind a number
 * nobody was told about. So it comes back with `tier: "mutation"`, and the
 * caller's job is to say so out loud.
 */
export const EVENT_TIME_TIERS = {
  event: ["occurred_at", "occurredat", "timestamp", "time", "date", "event_date", "eventdate", "booked_on", "bookedon"],
  creation: ["created_at", "createdat", "created", "date_created", "datecreated"],
  mutation: ["updated_at", "updatedat", "modified_at", "modifiedat", "updated", "modified"],
} as const;

export type EventTimeTier = keyof typeof EVENT_TIME_TIERS | "other";

export type DateKeyDetection = {
  /** The key to date events from, or null when the tier's candidates tie. */
  key: string | null;
  /** Which tier it came from. "mutation" is the one a caller must announce. */
  tier: EventTimeTier | null;
  /** Every key that qualified IN THE WINNING TIER — the names, when it is a tie. */
  candidates: string[];
  /**
   * Every key that qualified, in every tier, ranked.
   *
   * What a PICKER offers, as opposed to what the detector chose. The two differ
   * on purpose: the ranking exists so nobody has to think about `updated_at`,
   * and the list exists so somebody who has thought about it can still say yes.
   * A user overruling the ranking is a decision; the detector making the same
   * choice silently is not.
   */
  qualified: string[];
};

/** Flatten one payload to `path -> value`, one level of nesting deep. */
function flatten(payload: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return out;
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k.startsWith("__")) continue; // internal engine stamps, never source data
    if (v && typeof v === "object" && !Array.isArray(v)) {
      // ONE level. Provider payloads routinely wrap in `data`/`event`/`payload`,
      // and the real timestamp lives inside; deeper than that is a tree walk
      // whose candidate set grows faster than anyone can choose from.
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out.set(`${k}.${k2}`, v2);
    } else {
      out.set(k, v);
    }
  }
  return out;
}

/** The tier a key belongs to, by its LAST path segment (`data.created_at` is creation). */
function tierOf(path: string): EventTimeTier {
  const leaf = (path.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const tier of ["event", "creation", "mutation"] as const) {
    if ((EVENT_TIME_TIERS[tier] as readonly string[]).some((n) => n.replace(/[^a-z0-9]/g, "") === leaf)) return tier;
  }
  return "other";
}

export function detectDateKey(payloads: readonly unknown[]): DateKeyDetection {
  const byKey = new Map<string, unknown[]>();
  for (const payload of payloads.slice(0, DETECT_ROWS)) {
    for (const [path, value] of flatten(payload)) {
      const bucket = byKey.get(path);
      if (bucket) bucket.push(value);
      else byKey.set(path, [value]);
    }
  }
  const qualified = [...byKey.entries()].filter(([path, values]) => qualifiesAsDateField(path.split(".").pop() ?? path, values));

  const ranked = (["event", "creation", "mutation", "other"] as const).flatMap((tier) =>
    qualified.filter(([path]) => tierOf(path) === tier).map(([path]) => path),
  );
  // Highest tier that has anything, then ties inside it. "other" last, so a
  // conventional name always beats an invented one.
  for (const tier of ["event", "creation", "mutation", "other"] as const) {
    const inTier = qualified.filter(([path]) => tierOf(path) === tier).map(([path]) => path);
    if (inTier.length === 0) continue;
    return { key: inTier.length === 1 ? inTier[0] : null, tier, candidates: inTier, qualified: ranked };
  }
  return { key: null, tier: null, candidates: [], qualified: [] };
}
