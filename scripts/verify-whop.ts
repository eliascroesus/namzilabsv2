/**
 * Live probe for the Whop connector, in the shape of the other verify-* scripts.
 *
 * Exists because Whop's API is DATE-VERSIONED and this connector has now been
 * broken twice by the same mechanism: a parameter is renamed or withdrawn in a
 * new version, and an unpinned caller is moved onto it without notice. First
 * `company_id` → `account_id`, then `updated_after` withdrawn with the message
 * "not supported natively yet — stay pinned before 2026-09-02-1 for it".
 *
 * Run it after any Whop change, and whenever a sweep starts 400ing:
 *
 *   set -a; . ./.env.local; set +a; pnpm tsx scripts/verify-whop.ts
 *
 * Reads the stored credential for the org's Whop connection; makes only GETs.
 */
import { neon } from "@neondatabase/serverless";
import { decryptStored } from "@/lib/crypto";
import { WHOP_API_VERSION } from "@/connectors/whop";

const API = "https://api.whop.com/api/v1";

type Probe = { ok: boolean; status: number; note: string };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL (set -a; . ./.env.local; set +a)");
    process.exit(2);
  }
  const sql = neon(url);
  const rows = (await sql`select credentials_encrypted from connections where source='whop' limit 1`) as Array<{
    credentials_encrypted: string | null;
  }>;
  if (rows.length === 0 || !rows[0].credentials_encrypted) {
    console.error("No Whop connection with stored credentials found.");
    process.exit(2);
  }
  const creds = JSON.parse(decryptStored(rows[0].credentials_encrypted)) as Record<string, unknown>;
  const key = String(creds.apiKey ?? "");
  const company = String(creds.companyId ?? "");
  console.log(`connection: companyId=${company} apiKey=${key.slice(0, 8)}…`);
  console.log(`connector pins: Api-Version-Date: ${WHOP_API_VERSION}\n`);

  const call = async (label: string, path: string, headers: Record<string, string>): Promise<Probe> => {
    const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${key}`, ...headers } });
    const body = await res.text();
    let note = body.slice(0, 150);
    if (res.ok) {
      try {
        const j = JSON.parse(body) as { data?: unknown[]; page_info?: unknown };
        note = `rows=${Array.isArray(j.data) ? j.data.length : "?"} page_info=${JSON.stringify(j.page_info ?? null)}`;
      } catch {
        /* keep the raw slice */
      }
    }
    console.log(`${res.ok ? " OK  " : "FAIL "}[${res.status}] ${label}\n        ${note}`);
    return { ok: res.ok, status: res.status, note };
  };

  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const base = `account_id=${company}&first=2&order=created_at&direction=asc`;
  const upd = `${base}&updated_after=${encodeURIComponent(since)}`;

  console.log("--- 1. the reported failure: updated_after with NO version header ---");
  await call("payments +updated_after, unpinned", `/payments?${upd}`, {});

  console.log("\n--- 2. is the unpinned default really the frozen 2025-01-01 shape? ---");
  await call("payments with the OLD company_id name, unpinned", `/payments?company_id=${company}&first=2`, {});

  console.log("\n--- 3. which header name does the API actually honor? ---");
  for (const h of ["Api-Version-Date", "x-api-version-date", "whop-version"]) {
    await call(`payments +updated_after, ${h}: ${WHOP_API_VERSION}`, `/payments?${upd}`, { [h]: WHOP_API_VERSION });
  }

  console.log("\n--- 4. sweep versions for updated_after support (Api-Version-Date) ---");
  for (const v of ["2025-01-01", "2026-07-01", "2026-08-21", "2026-08-21-1", "2026-09-02-1", "2026-09-15"]) {
    await call(`payments +updated_after @ ${v}`, `/payments?${upd}`, { "Api-Version-Date": v });
  }

  console.log("\n--- 5. the version we pin must also keep account_id and memberships ---");
  await call(`payments account_id @ ${WHOP_API_VERSION}`, `/payments?${base}`, { "Api-Version-Date": WHOP_API_VERSION });
  await call(
    `memberships +created_after @ ${WHOP_API_VERSION}`,
    `/memberships?account_id=${company}&first=2&order=created_at&direction=asc&created_after=${encodeURIComponent(since)}`,
    { "Api-Version-Date": WHOP_API_VERSION },
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
