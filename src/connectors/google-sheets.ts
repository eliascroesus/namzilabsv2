import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

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

  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    // Apps Script push path: a single row object.
    const row = asObject(rawPayload);
    const rowNumber = str(row["row"]) ?? str(row["rowNumber"]) ?? String(Date.now());
    return [
      {
        eventId: `gsheets:${ctx.connectionId}:row:${rowNumber}`,
        eventType: "row_added",
        subject: str(row["email"]) ?? null,
        occurredAt: parseDate(str(row["timestamp"])) ?? new Date(),
        properties: row,
      },
    ];
  },

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
        if (probed !== "|" && probed === marker.stamp && marker.skips < FULL_READ_EVERY - 1) {
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
async function readRows(args: PollArgs, knownStamp: string | null = null, fromDataRow = 0): Promise<PollResult> {
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
  const records: CanonicalEvent[] = [];
  for (let i = fromDataRow; i < dataRows.length; i++) {
    const cells = dataRows[i];
    // Fully blank rows carry no data: skip them, so a row someone cleared out
    // mirrors as deleted (its id stops being produced) rather than as an
    // event whose every field is empty.
    if (!cells || cells.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, c) => (obj[h || `col${c}`] = cells[c] ?? null));
    const sheetRowNumber = i + 2; // account for header + 1-based rows
    records.push({
      eventId: `gsheets:${args.connectionId}:${streamTag}row:${sheetRowNumber}`,
      eventType: "row_added",
      subject: firstEmailLike(obj),
      occurredAt: new Date(),
      properties: obj,
    });
  }
  return { records, nextCursor, providerCalls, extraCalls };
}

function firstEmailLike(obj: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (/email/i.test(k) || v.includes("@"))) return v;
  }
  return null;
}

