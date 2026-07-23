import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson } from "@/lib/http-client";
import { asObject, parseDate, str } from "./field-utils";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

/**
 * Google Sheets — a MIRROR source. A spreadsheet is mutable state (cells get
 * edited, rows deleted, tabs sorted) with no changelog API, so every poll
 * re-reads the ENTIRE tab in one request and the sync layer reconciles our copy
 * 1:1 (refresh every row, soft-delete rows the read no longer saw). This is the
 * Fivetran model — the only correct one for sheets; the old "new rows since a
 * row-count cursor" model froze each row at first capture and could never see
 * an edit again. An optional Apps Script push can still POST rows to the
 * inbound URL; those are verified with an HMAC secret and normalized the same
 * way.
 *
 * config: { spreadsheetId: string, range?: string }  (range e.g. "Sheet1")
 */
export const googleSheetsConnector: Connector = {
  source: "gsheets",
  authType: "oauth2",
  syncStrategy: "mirror",
  // A row's occurredAt is "when we first saw content at this row" — synthetic,
  // so the upsert keeps the stored value and mirror sweeps never churn order.
  preserveOccurredAt: true,

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

  async poll(args: PollArgs): Promise<PollResult> {
    // Mirror semantics: the cursor is deliberately ignored — every poll is a
    // full read of the tab (one API call), so edits anywhere are always seen.
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

/** Read the whole tab and map every non-empty data row to a canonical record. */
async function readRows(args: PollArgs): Promise<PollResult> {
  const token = str(args.credentials?.["accessToken"]);
  if (!token) throw new Error("gsheets: missing access token");
  const spreadsheetId = str(args.config?.["spreadsheetId"]);
  if (!spreadsheetId) throw new Error("gsheets: missing spreadsheetId in config");
  const range = str(args.config?.["range"]) ?? "Sheet1";

  const data = await fetchJson<{ values?: string[][] }>(
    `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  const values = data.values ?? [];
  if (values.length === 0) return { records: [], nextCursor: null };

  const header = values[0];
  const dataRows = values.slice(1);
  // Row numbers repeat across spreadsheets/tabs, so the stream identity is part of
  // the dedup key — two streams' "row 5" must never collide.
  const streamTag = args.streamHash ? `${args.streamHash}:` : "";
  const records: CanonicalEvent[] = [];
  for (let i = 0; i < dataRows.length; i++) {
    const cells = dataRows[i];
    // A fully-blank row is not a record. Skipping it must NOT shift the row
    // numbers of everything below it, so the sheet row number stays i-based.
    if (cells.every((c) => c == null || String(c).trim() === "")) continue;
    const obj: Record<string, unknown> = {};
    header.forEach((h, c) => (obj[h || `col${c}`] = cells[c] ?? null));
    const sheetRowNumber = i + 2; // account for header + 1-based rows
    records.push({
      eventId: `gsheets:${args.connectionId}:${streamTag}row:${sheetRowNumber}`,
      eventType: "row_added",
      subject: firstEmailLike(obj),
      // First-seen timestamp: applied on insert only (preserveOccurredAt).
      occurredAt: new Date(),
      properties: obj,
    });
  }
  return { records, nextCursor: null };
}

function firstEmailLike(obj: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (/email/i.test(k) || v.includes("@"))) return v;
  }
  return null;
}

