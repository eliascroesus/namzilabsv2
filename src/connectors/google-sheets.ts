import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

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

    if (token && spreadsheetId && marker) {
      try {
        const meta = await fetchJson<{ modifiedTime?: string; version?: string }>(
          `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime,version`,
          { headers: { authorization: `Bearer ${token}` } },
        );
        const stamp = `${meta.modifiedTime ?? ""}|${meta.version ?? ""}`;
        // `modifiedTime` is the doubtful part of this contract: recalculated
        // formulas (IMPORTRANGE, NOW, anything volatile) can change what a cell
        // READS without the file being edited. So the skip is bounded — every
        // FULL_READ_EVERY skips we read anyway, whatever Drive says. Cheap
        // insurance against a whole class of silently-stale sheet.
        if (stamp !== "|" && stamp === marker.stamp && marker.skips < FULL_READ_EVERY - 1) {
          return { records: [], nextCursor: serializeMarker({ stamp, skips: marker.skips + 1 }), unchanged: true };
        }
      } catch {
        // Drive unreachable, or the token lacks the scope: fall through and read
        // the tab. Degrading to the old behaviour is always safe.
      }
    }
    return readRows(args);
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

async function readRows(args: PollArgs, fromDataRow = 0): Promise<PollResult> {
  const token = str(args.credentials?.["accessToken"]);
  if (!token) throw new Error("gsheets: missing access token");
  const spreadsheetId = str(args.config?.["spreadsheetId"]);
  if (!spreadsheetId) throw new Error("gsheets: missing spreadsheetId in config");
  const range = str(args.config?.["range"]) ?? "Sheet1";

  const data = await fetchJson<{ values?: string[][] }>(
    `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  // Stamp the read with the file's current version, so the next sweep has
  // something to compare against. Best-effort: without it the next poll simply
  // reads the tab, which is the old behaviour.
  let stamp = "";
  try {
    const meta = await fetchJson<{ modifiedTime?: string; version?: string }>(
      `${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=modifiedTime,version`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    stamp = `${meta.modifiedTime ?? ""}|${meta.version ?? ""}`;
  } catch {
    // Leave the marker unset.
  }
  // Keep the previous marker when Drive was unreachable, rather than discarding
  // it: a transient blip should not also cost the NEXT sweep a full read. A
  // stale marker is safe — it only skips when it MATCHES a freshly fetched
  // stamp, and we just failed to fetch one.
  const nextCursor = stamp && stamp !== "|" ? serializeMarker({ stamp, skips: 0 }) : args.cursor;

  const values = data.values ?? [];
  if (values.length === 0) return { records: [], nextCursor };

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
  return { records, nextCursor };
}

function firstEmailLike(obj: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (/email/i.test(k) || v.includes("@"))) return v;
  }
  return null;
}

