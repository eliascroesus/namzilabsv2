import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson } from "@/lib/http-client";
import { str } from "./field-utils";
import { detectDateColumn, normalizeDateValue } from "@/lib/normalize-dates";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

/**
 * The two endpoints one poll uses, and they are budgeted SEPARATELY because
 * Google budgets them separately: this Cloud project gets 300 Sheets reads a
 * minute and 12,000 Drive requests. Sharing one bucket means the Sheets number
 * governs the Drive probe, which is backwards — the probe exists to AVOID Sheets
 * reads, so rationing it at the Sheets rate throws away the saving.
 *
 * `operationFor` returns the Sheets one: it is what a poll is claimed against up
 * front, and it is the tighter of the two, so pre-authorising against it is the
 * conservative choice. The probe's own spend is attributed afterwards through
 * `PollResult.extraCalls`.
 */
const SHEETS_OP = "sheets.values.get";
const DRIVE_OP = "drive.files.get";

/**
 * Google Sheets. MIRROR source: every poll re-reads the ENTIRE tab and the
 * caller (syncStream) refreshes rows in place and soft-deletes rows the read
 * no longer produced — a spreadsheet is a living document, not an append-only
 * log, so edits and deletions anywhere in it must be reflected. Row identity
 * is the sheet row number (scoped by stream), so re-sorting re-keys rows but
 * the mirrored set always equals the sheet. An optional Apps Script/Drive push
 * can POST rows to the inbound URL; those are verified with an HMAC secret and
 * normalized the same way.
 *
 * config: { spreadsheetId: string, range?: string }  (range e.g. "Sheet1")
 */
export const googleSheetsConnector: Connector = {
  source: "gsheets",
  authType: "oauth2",
  operations: [SHEETS_OP, DRIVE_OP] as const,
  operationFor: () => SHEETS_OP,

  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return true;
    const provided = headers["x-namzilabs-signature"];
    if (!provided) return false;
    const normalized = provided.startsWith("sha256=") ? provided.slice("sha256=".length) : provided;
    return safeEqual(normalized, hmacSha256Hex(secret, rawBody));
  },

  // NO `normalize`. This source is stream-scoped, so the webhook route answers
  // `isStreamScoped` and rings the connection's doorbell before verification or
  // storage — nothing ever reached the Apps Script push path. What lived here
  // guessed a hard-coded `row["timestamp"]` while the poll below stamped
  // `new Date()`: two different wrong answers for one source, and because this
  // one was unreachable nothing could ever contradict it. If the push path is
  // built, it reads `PollArgs.dateField` like the poll does.

  /**
   * Mirror semantics: whenever this reads, it reads the WHOLE tab. What changed
   * is that it first asks Drive whether the file has been touched at all.
   *
   * Every sweep used to transfer the entire tab and run a full upsert + retire
   * pass whether or not a cell had moved — one API call, but the whole payload
   * and the whole write, every ten minutes, forever. `files.get` returns
   * `modifiedTime` in a few hundred bytes.
   *
   * No re-consent: `drive.readonly` is already in the gsheets grant
   * (`src/lib/google-oauth.ts`) and this connector already calls the Drive API
   * with the same token for the spreadsheet picker.
   */
  async poll(args: PollArgs): Promise<PollResult> {
    const marker = parseMarker(args.cursor);
    const token = str(args.credentials?.["accessToken"]);
    const spreadsheetId = str(args.config?.["spreadsheetId"]);

    let probed: string | null = null;
    // Requests this poll issues, so the ledger can settle up. A skip costs ONE
    // (the Drive probe) and a real read costs two (probe + values); a first sync
    // also costs two (no probe, but a stamp before the values read). The runner
    // claims one per poll, so without this the ledger sees half of a real read —
    // and Google's quota is per Cloud PROJECT, shared by every customer, so a
    // fleet ceiling built on claims would authorise twice what it says.
    let probeCalls = 0;

    if (token && spreadsheetId && marker) {
      probeCalls = 1; // counted on attempt: a failed request still cost quota
      try {
        probed = await fetchStamp(token, spreadsheetId);
        // `modifiedTime` is the doubtful part of this contract: recalculated
        // formulas (IMPORTRANGE, NOW, anything volatile) can change what a cell
        // READS without the file being edited. So the skip is bounded — every
        // FULL_READ_EVERY skips we read anyway, whatever Drive says. Cheap
        // insurance against a whole class of silently-stale sheet.
        // `restamp` overrides all of it. The sheet has NOT changed — that is
        // precisely the case where a restamp is needed and would never fire,
        // because what changed is which column we read the date from. A settled
        // sheet is the normal state, so without this the correction the user
        // just asked for would wait up to FULL_READ_EVERY sweeps, or forever if
        // they keep it settled.
        if (!args.restamp && probed !== "|" && probed === marker.stamp && marker.skips < FULL_READ_EVERY - 1) {
          return {
            records: [],
            nextCursor: serializeMarker({ stamp: probed, skips: marker.skips + 1 }),
            unchanged: true,
            providerCalls: probeCalls,
            // A skip spends Drive quota and no Sheets quota. The one Sheets call
            // the runner claimed up front stands as a reservation it did not use
            // — over-counting the tighter bucket by one, which defers earlier and
            // is the safe direction to be wrong in.
            extraCalls: { [DRIVE_OP]: probeCalls },
          };
        }
      } catch {
        // Drive unreachable, or the token lacks the scope: fall through and read
        // the tab. Degrading to the old behaviour is always safe.
      }
    }
    // The probe already knows what version we are about to read. Handing it down
    // is both the correctness fix and one request cheaper — see readRows.
    const read = await readRows(args, probed);
    return {
      ...read,
      providerCalls: (read.providerCalls ?? 0) + probeCalls,
      extraCalls: { [DRIVE_OP]: (read.extraCalls?.[DRIVE_OP] ?? 0) + probeCalls },
    };
  },

  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    const token = str(args.credentials?.["accessToken"]);
    if (!token) throw new Error("gsheets: missing access token");
    if (key === "spreadsheetId") {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        orderBy: "modifiedTime desc",
        pageSize: "100",
        fields: "files(id,name)",
      });
      const data = await fetchJson<{ files?: Array<{ id: string; name: string }> }>(`${DRIVE_API}?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      return (data.files ?? []).map((f) => ({ value: f.id, label: f.name }));
    }
    /**
     * The header row, offered as the date-column picker's options.
     *
     * One extra Sheets read at config time, on the interactive path where every
     * other `listOptions` call already lives. Reading the first row only — A1:Z1
     * — because the picker needs column NAMES, not the tab.
     */
    if (key === "dateField") {
      const spreadsheetId = str(args.config?.["spreadsheetId"]);
      const range = str(args.config?.["range"]) ?? "Sheet1";
      if (!spreadsheetId) return [];
      const data = await fetchJson<{ values?: string[][] }>(
        `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${range}!A1:Z1`)}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      return (data.values?.[0] ?? [])
        .map((h) => String(h ?? "").trim())
        .filter((h) => h !== "")
        .map((h) => ({ value: h, label: h }));
    }
    if (key === "range") {
      const spreadsheetId = str(args.config?.["spreadsheetId"]);
      if (!spreadsheetId) return [];
      const data = await fetchJson<{ sheets?: Array<{ properties?: { title?: string } }> }>(
        `${API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(title)`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      return (data.sheets ?? [])
        .map((s) => s.properties?.title)
        .filter((t): t is string => !!t)
        .map((t) => ({ value: t, label: t }));
    }
    return [];
  },

  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await readRows(args);
    return records.slice(-n).reverse();
  },
};

/**
 * How many consecutive "unchanged" answers we accept before reading anyway.
 * Six is roughly an hour at base cadence.
 */
const FULL_READ_EVERY = 6;

/** The change-detection marker carried in the stream cursor. */
type SheetMarker = { stamp: string; skips: number };

function parseMarker(cursor: string | null): SheetMarker | null {
  if (!cursor || !cursor.startsWith("{")) return null;
  try {
    const p = JSON.parse(cursor) as Partial<SheetMarker>;
    return typeof p.stamp === "string" ? { stamp: p.stamp, skips: typeof p.skips === "number" ? p.skips : 0 } : null;
  } catch {
    return null;
  }
}

function serializeMarker(m: SheetMarker): string {
  return JSON.stringify(m);
}

/** The file's current `modifiedTime|version`, as one comparable string. */
async function fetchStamp(token: string, spreadsheetId: string): Promise<string> {
  const meta = await fetchJson<{ modifiedTime?: string; version?: string }>(
    `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime,version`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  return `${meta.modifiedTime ?? ""}|${meta.version ?? ""}`;
}

/**
 * `knownStamp` is the version observed BEFORE the values read — from the
 * caller's probe when there was one.
 *
 * THE ORDER IS THE WHOLE POINT. Stamping AFTER the read, as this did, stores
 * the contents from before an edit under the version from after it: the values
 * call and the Drive call are two separate requests, and an edit landing in the
 * gap is captured by the second but not the first. The next poll's probe then
 * MATCHES the stored stamp, skips, and the edit stays invisible until
 * FULL_READ_EVERY forces a read — up to an hour of silent staleness on a source
 * whose entire contract is that it mirrors the sheet.
 *
 * Stamping from before the read cannot do that. An edit in the gap now stores
 * post-edit contents under a PRE-edit stamp, so the next probe mismatches and
 * re-reads: one redundant read instead of a wrong answer nobody can see. When
 * a race is unavoidable, the survivable direction is the one that re-reads.
 *
 * Cheaper too, incidentally: a changed poll is the probe plus the values read,
 * where it used to be the probe, the values read, and a second Drive call.
 */
async function readRows(args: PollArgs, knownStamp: string | null = null): Promise<PollResult> {
  const token = str(args.credentials?.["accessToken"]);
  if (!token) throw new Error("gsheets: missing access token");
  const spreadsheetId = str(args.config?.["spreadsheetId"]);
  if (!spreadsheetId) throw new Error("gsheets: missing spreadsheetId in config");
  const range = str(args.config?.["range"]) ?? "Sheet1";

  // Best-effort: without a stamp the next poll simply reads the tab, which is
  // the old behaviour. Fetched here, before the read, when the caller had no
  // probe to hand down — a first sync, or a probe that failed.
  let stamp = knownStamp ?? "";
  if (!stamp) {
    try {
      stamp = await fetchStamp(token, spreadsheetId);
    } catch {
      // Leave the marker unset.
    }
  }

  const data = await fetchJson<{ values?: string[][] }>(
    `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  // The values read above, plus the stamp fetch only when the caller had no
  // probe to hand down. Counted on attempt — a failed Drive call still reached
  // Google.
  const providerCalls = knownStamp ? 1 : 2;
  // …and the stamp fetch is a DRIVE request, not a Sheets one. Attributed rather
  // than added on, so the total charged still equals `providerCalls`.
  const extraCalls = knownStamp ? undefined : { [DRIVE_OP]: 1 };
  // Keep the previous marker when Drive was unreachable, rather than discarding
  // it: a transient blip should not also cost the NEXT sweep a full read. A
  // stale marker is safe — it only skips when it MATCHES a freshly fetched
  // stamp, and we just failed to fetch one.
  const nextCursor = stamp && stamp !== "|" ? serializeMarker({ stamp, skips: 0 }) : args.cursor;

  const values = data.values ?? [];
  if (values.length === 0) return { records: [], nextCursor, providerCalls, extraCalls };

  const header = values[0];
  const dataRows = values.slice(1);
  // Row numbers repeat across spreadsheets/tabs, so the stream identity is part of
  // the dedup key — two streams' "row 5" must never collide.
  const streamTag = args.streamHash ? `${args.streamHash}:` : "";

  /**
   * The date column: the one the user nominated, or — when nobody has answered
   * the question for this stream — the one this read can detect.
   *
   * DETECTION IS RECOMPUTED, never remembered. `date_field` means the user's
   * answer and nothing else, so the sweep never writes to a column the picker
   * owns and a sheet that gains or loses a date column is followed rather than
   * pinned to whatever was true the first time it was read.
   *
   * `presentInHeader` is the named condition for a CHOSEN column that was
   * renamed or removed. Without it that case is indistinguishable from a column
   * full of malformed dates — both make every row undated — and the two need
   * different fixes: one is "rename it back or re-pick", the other is "the dates
   * are not dates". Only this function has the header row to tell them apart. A
   * detected column is present by construction, which is why the flag says
   * nothing interesting there.
   */
  const chosen = args.dateField ?? null;
  const detection = chosen == null && args.detectDateField ? detectDateColumn(header, dataRows) : null;
  const dateField = chosen ?? detection?.column ?? null;
  const source: "user" | "detected" = detection ? "detected" : "user";
  const dateColumn = dateField ? header.findIndex((h) => h === dateField) : -1;
  const presentInHeader = dateColumn >= 0;
  let dated = 0;
  // The ids, not only the count, because the restamp has to move exactly these
  // rows to their first-seen time and the runner cannot tell them apart from the
  // outside: a parsed date and a synthesized fallback both arrive as a Date.
  const undatedEventIds = new Set<string>();

  const records: CanonicalEvent[] = [];
  // EVERY data row, every time. There is deliberately no way to ask for a
  // slice: a mirror's contract is that the read covered the whole resource,
  // and `retireAbsent` tombstones this stream's rows that the read did not
  // produce. A partial read therefore reads as "every row before this one was
  // deleted upstream". The offset parameter that used to sit here was unused
  // by both call sites and is gone rather than documented, because a comment
  // cannot stop the next caller passing one.
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    // Fully blank rows carry no data: skip them, so a row someone cleared out
    // mirrors as deleted (its id stops being produced) rather than as an
    // event whose every field is empty.
    if (!cells || cells.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, c) => (obj[h || `col${c}`] = cells[c] ?? null));
    const sheetRowNumber = i + 2; // account for header + 1-based rows

    /**
     * First-seen unless the nominated column yields a date.
     *
     * `new Date()` on its own was the defect: a spreadsheet row has no timestamp
     * of its own, so `occurred_at` became the import moment and every time-based
     * metric over a sheet measured when the data was imported.
     *
     * Parsed by `normalizeDateValue`, which was built for exactly these shapes —
     * its own docstring names "7/21/2026 14:23:45" as the sheet case — and has
     * been canonicalizing them into `properties` since day one, and into
     * `occurred_at` never. The HEADER NAME is passed as the field name, so its
     * gate on purely-numeric values still applies: a column of epoch seconds
     * parses when it is called "Created" and does not when it is called "Ref".
     * Nominating a column is a choice about WHICH column, not a licence to
     * reinterpret values the detector would refuse anywhere else — and an
     * under-parse is counted and shown, where an over-parse silently invents
     * dates.
     */
    const eventId = `gsheets:${args.connectionId}:${streamTag}row:${sheetRowNumber}`;
    let occurredAt = new Date();
    if (dateField) {
      const canonical = presentInHeader ? normalizeDateValue(cells[dateColumn], dateField) : null;
      const parsed = canonical ? Date.parse(canonical) : NaN;
      if (Number.isFinite(parsed)) {
        occurredAt = new Date(parsed);
        dated += 1;
      } else {
        undatedEventIds.add(eventId);
      }
    }

    records.push({
      eventId,
      eventType: "row_added",
      subject: firstEmailLike(obj),
      occurredAt,
      properties: obj,
    });
  }
  return {
    records,
    nextCursor,
    providerCalls,
    extraCalls,
    // Reported whenever anything was ASKED — a chosen column, or a detection
    // that ran — including when the answer is "nothing dated these rows".
    // Omitting it there would leave "we looked and found nothing" reading as
    // "we never looked", and the runner uses exactly that difference to decide
    // whether a settled sheet still owes a read.
    dateFieldState:
      chosen != null || detection != null
        ? {
            column: dateField,
            source,
            presentInHeader,
            dated,
            undated: undatedEventIds.size,
            ...(detection && detection.candidates.length > 1 ? { candidates: detection.candidates } : {}),
          }
        : undefined,
    undatedEventIds: dateField ? undatedEventIds : undefined,
  };
}

function firstEmailLike(obj: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (/email/i.test(k) || v.includes("@"))) return v;
  }
  return null;
}

