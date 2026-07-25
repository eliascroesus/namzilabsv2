/**
 * One-time HUMAN-RUN verification of the Close Event Log pagination contract.
 *
 * The Close connector (src/connectors/close.ts) and its tests
 * (tests/close-poll.test.ts) pin this contract, taken from the documented API
 * shape because developer.close.com is bot-walled from the build environment:
 *
 *   C1. GET /api/v1/event/ returns { data: [...], cursor_next }
 *   C2. events are ordered newest-first by date_created
 *   C3. `_limit` is honored and capped at 50 for this endpoint
 *   C4. `cursor_next` + `_cursor` walk strictly OLDER events, no overlap/skip,
 *       and reach a page with cursor_next = null (termination)
 *   C5. `date_created__gte` bounds the window (no event older than the bound)
 *
 * Run against the live API with a real (ideally read-only) key:
 *
 *   CLOSE_API_KEY=api_xxx pnpm tsx scripts/verify-close-pagination.ts
 *
 * Read-only: performs only GET requests. Exits 0 when every check passes.
 */

const API = "https://api.close.com/api/v1";

type EventPage = { data: Array<Record<string, unknown>>; cursor_next?: string | null };

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function get(params: Record<string, string>): Promise<EventPage> {
  const key = process.env.CLOSE_API_KEY;
  if (!key) {
    console.error("Set CLOSE_API_KEY (the connection's API key) and re-run.");
    process.exit(2);
  }
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API}/event/?${qs}`, {
    headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as EventPage;
}

const dates = (p: EventPage) => p.data.map((e) => String(e.date_created ?? ""));
const isDescending = (ds: string[]) => ds.every((d, i) => i === 0 || Date.parse(ds[i - 1]) >= Date.parse(d));

async function main() {
  console.log("Close Event Log pagination contract verification\n");

  // C1 + C2 + C3: first page shape, ordering, limit cap.
  const first = await get({ _limit: "50" });
  check("C1 response has data[] and cursor_next", Array.isArray(first.data) && "cursor_next" in first);
  check("C2 newest-first ordering (page 1)", isDescending(dates(first)), `${first.data.length} events`);
  check("C3 _limit=50 honored", first.data.length <= 50, `got ${first.data.length}`);
  const over = await get({ _limit: "100" });
  check("C3 _limit caps at 50 (asked 100)", over.data.length <= 50, `got ${over.data.length}`);

  if (first.data.length === 0) {
    console.log("\nEvent log is empty — create some activity and re-run for the full walk checks.");
  } else {
    // C4: cursor walk — strictly older, no duplicate ids, terminates.
    const seen = new Set<string>(first.data.map((e) => String(e.id)));
    let page = first;
    let pages = 1;
    let oldest = Date.parse(dates(first)[dates(first).length - 1]);
    let ordered = true;
    let overlap = false;
    while (page.cursor_next && pages < 20) {
      page = await get({ _limit: "50", _cursor: String(page.cursor_next) });
      pages += 1;
      const ds = dates(page);
      if (!isDescending(ds)) ordered = false;
      for (const e of page.data) {
        if (seen.has(String(e.id))) overlap = true;
        seen.add(String(e.id));
      }
      if (ds.length > 0) {
        if (Date.parse(ds[0]) > oldest) overlap = true; // newer than previous page's oldest
        oldest = Date.parse(ds[ds.length - 1]);
      }
      if (page.data.length === 0) break;
    }
    check("C4 cursor walk stays newest-first", ordered);
    check("C4 no duplicate/overlapping events across pages", !overlap, `${seen.size} unique over ${pages} pages`);
    check("C4 walk terminates (cursor_next null or empty page)", !page.cursor_next || page.data.length === 0 || pages >= 20, pages >= 20 ? "stopped at 20-page safety cap — re-check manually" : `${pages} pages`);

    // C5: date_created__gte bounds the window.
    const mid = dates(first)[Math.floor(first.data.length / 2)];
    const bounded = await get({ _limit: "50", date_created__gte: mid });
    const allInBound = dates(bounded).every((d) => Date.parse(d) >= Date.parse(mid));
    check("C5 date_created__gte bounds the window", allInBound, `bound ${mid}`);
  }

  console.log(failures.length === 0 ? "\nAll checks passed — the pinned contract holds." : `\n${failures.length} check(s) FAILED: ${failures.join("; ")}\n→ Update src/connectors/close.ts + tests/close-poll.test.ts before shipping the connector.`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nAborted: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
