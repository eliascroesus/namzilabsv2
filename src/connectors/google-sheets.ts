import type { Connector, CanonicalEvent, VerifyArgs, NormalizeContext, PollArgs, PollResult, ListOptionsArgs, SourceOption } from "./types";
import { hmacSha256Hex, safeEqual } from "@/lib/signatures";
import { fetchJson } from "@/lib/http-client";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

/**
 * Google Sheets. Poll-PRIMARY: Sheets has no native "new row" webhook, so we
 * page through the sheet with a row cursor (the reliable path). An optional
 * Apps Script/Drive push can POST rows to the inbound URL; those are verified
 * with an HMAC secret and normalized the same way.
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

  async poll(args: PollArgs): Promise<PollResult> {
    return readRows(args, args.cursor ? Number(args.cursor) : 0);
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
    const { records } = await readRows(args, 0);
    return records.slice(-n).reverse();
  },
};

async function readRows(args: PollArgs, fromDataRow: number): Promise<PollResult> {
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
  if (values.length === 0) return { records: [], nextCursor: "0" };

  const header = values[0];
  const dataRows = values.slice(1);
  // Row numbers repeat across spreadsheets/tabs, so the stream identity is part of
  // the dedup key — two streams' "row 5" must never collide.
  const streamTag = args.streamHash ? `${args.streamHash}:` : "";
  const records: CanonicalEvent[] = [];
  for (let i = fromDataRow; i < dataRows.length; i++) {
    const cells = dataRows[i];
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
  return { records, nextCursor: String(dataRows.length) };
}

function firstEmailLike(obj: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && (/email/i.test(k) || v.includes("@"))) return v;
  }
  return null;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
