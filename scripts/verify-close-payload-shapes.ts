/**
 * Do Close's TWO representations of one event agree?
 *
 * The webhook posts `{event: {...}}` and the Event Log returns an event object.
 * The connector stores whichever it was handed as `properties`, verbatim, and
 * both paths write the same `event_id`. So if the two objects differ by even one
 * key, `properties` differs from `excluded.properties` on every sweep, the row
 * is rewritten every ten minutes, `updated > 0` marks the stream changed, and
 * every Close connection is pinned at base cadence with a recompute behind it —
 * a permanent churn loop driven by nothing changing.
 *
 * Close's webhook payload is documented as possibly carrying `meta`,
 * `changed_fields`, `previous_data` and `request_id`. Whether the Event Log's
 * copy of the same event carries them too is the question, and it is not
 * answerable from documentation on either side: what matters is byte equality of
 * what we STORE, which only a real pair can show.
 *
 * THIS REPORTS THE DIFF AND DECIDES NOTHING. The fix — normalising `properties`
 * to a common subset, or keying the change gate differently — depends on which
 * keys differ and whether they are stable, and choosing before measuring is how
 * the signing key came to be a hex string used as UTF-8.
 *
 * A NOTE ON WHEN THIS CAN RUN. Until the hex-key fix landed, no Close webhook
 * had ever verified, so `raw_events` holds no Close payload to compare against
 * and this script will say so and stop. That is the honest state, not an error:
 * the measurement becomes possible with the first verified delivery.
 *
 * Read-only on both sides — one SELECT, one GET.
 *
 *   DATABASE_URL="postgresql://…" CLOSE_API_KEY=api_xxx \
 *     pnpm tsx scripts/verify-close-payload-shapes.ts [connectionId]
 */
import { neon } from "@neondatabase/serverless";

const API = "https://api.close.com/api/v1";

type Row = { id: string; connection_id: string; payload: unknown; received_at: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every key path in an object, so a nested-only difference is still visible. */
function keyPaths(v: unknown, prefix = ""): string[] {
  if (!isObj(v)) return [];
  return Object.keys(v)
    .sort()
    .flatMap((k) => {
      const path = prefix ? `${prefix}.${k}` : k;
      return [path, ...keyPaths(v[k], path)];
    });
}

/** Stable stringify, so key ORDER never masquerades as a difference. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

async function main() {
  const url = process.env.DATABASE_URL;
  const key = process.env.CLOSE_API_KEY;
  if (!url || !key) {
    console.error("Set DATABASE_URL and CLOSE_API_KEY.");
    process.exit(2);
  }
  const connectionId = process.argv[2];
  const sql = neon(url);

  // The most recent VERIFIED Close webhook payload. `signature_valid` matters:
  // an unverified body never reaches raw_events, and asking for one anyway is
  // how you end up comparing against something that was never trusted.
  const rows = (await sql.query(
    `select r.id, r.connection_id, r.payload, r.received_at
       from raw_events r
       join connections c on c.id = r.connection_id
      where c.source = 'close' and r.signature_valid = true
        ${connectionId ? "and r.connection_id = $1" : ""}
      order by r.received_at desc
      limit 1`,
    connectionId ? [connectionId] : [],
  )) as Row[];

  if (rows.length === 0) {
    console.log("NO STORED CLOSE WEBHOOK PAYLOAD.");
    console.log("");
    console.log("Nothing to compare. Close webhook verification failed 100% of the time");
    console.log("before the hex-key fix, and a rejected delivery is never written to");
    console.log("raw_events — so this is the expected state until the first verified");
    console.log("delivery arrives. Re-run then.");
    process.exit(0);
  }

  const [row] = rows;
  const envelope = row.payload;
  const webhookEvent = isObj(envelope) ? envelope["event"] : undefined;
  if (!isObj(webhookEvent)) {
    console.log(`raw_event ${row.id}: payload has no object at .event — stored shape is`);
    console.log(canonical(envelope).slice(0, 2000));
    process.exit(1);
  }

  const eventId = typeof webhookEvent["id"] === "string" ? webhookEvent["id"] : null;
  if (!eventId) {
    console.log(`raw_event ${row.id}: webhook event carries no id, cannot fetch its Event Log twin`);
    process.exit(1);
  }

  const res = await fetch(`${API}/event/${eventId}/`, {
    headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  const body = await res.text();
  if (!res.ok) {
    console.log(`GET /event/${eventId}/ → ${res.status}`);
    console.log(body.slice(0, 2000));
    process.exit(1);
  }
  const polled: unknown = JSON.parse(body);
  if (!isObj(polled)) {
    console.log(`GET /event/${eventId}/ did not return an object`);
    process.exit(1);
  }

  const wKeys = new Set(keyPaths(webhookEvent));
  const pKeys = new Set(keyPaths(polled));
  const onlyWebhook = [...wKeys].filter((k) => !pKeys.has(k));
  const onlyPolled = [...pKeys].filter((k) => !wKeys.has(k));
  const shared = [...wKeys].filter((k) => pKeys.has(k));

  console.log(`event id            ${eventId}`);
  console.log(`raw_event           ${row.id}  (received ${row.received_at})`);
  console.log(`connection          ${row.connection_id}`);
  console.log("");
  console.log(`identical when stored? ${canonical(webhookEvent) === canonical(polled) ? "YES" : "NO"}`);
  console.log("");
  console.log(`keys only in the WEBHOOK copy (${onlyWebhook.length}):`);
  for (const k of onlyWebhook) console.log(`  + ${k}`);
  console.log(`keys only in the EVENT LOG copy (${onlyPolled.length}):`);
  for (const k of onlyPolled) console.log(`  - ${k}`);

  // A shared key holding different values churns exactly as hard as a missing
  // one, and is easier to miss — so it is listed separately rather than folded
  // into "identical: NO".
  const differing = shared.filter((k) => {
    const w = k.split(".").reduce<unknown>((acc, part) => (isObj(acc) ? acc[part] : undefined), webhookEvent);
    const p = k.split(".").reduce<unknown>((acc, part) => (isObj(acc) ? acc[part] : undefined), polled);
    return !isObj(w) && !isObj(p) && canonical(w) !== canonical(p);
  });
  console.log(`shared keys whose VALUES differ (${differing.length}):`);
  for (const k of differing) {
    const w = k.split(".").reduce<unknown>((acc, part) => (isObj(acc) ? acc[part] : undefined), webhookEvent);
    const p = k.split(".").reduce<unknown>((acc, part) => (isObj(acc) ? acc[part] : undefined), polled);
    console.log(`  ~ ${k}: webhook=${canonical(w).slice(0, 120)} polled=${canonical(p).slice(0, 120)}`);
  }
  console.log("");
  console.log("No decision is taken from this. Report the diff.");
}

main().catch((e) => {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

export {};
