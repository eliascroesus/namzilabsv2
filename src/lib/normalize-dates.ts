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
