/**
 * Instantly v2 — RAW EVIDENCE about every endpoint the connector actually reads.
 *
 * REPLACES `verify-instantly-pagination.ts`, which was 86 lines and predates
 * everything the Close and Calendly runs taught. Three gaps, and the third is the
 * one that mattered most:
 *
 * 1. **No skip detector.** It checked that two pages do not OVERLAP, which
 *    catches duplicates. A cursor that steps OVER ten records per page produces
 *    no duplicates at all and passed that check clean — the exact case that
 *    forced Close's detector to be rewritten.
 * 2. **No control comparison.** It never sent a filter and compared against an
 *    unfiltered request, which is the check that caught Close's dead parameter.
 * 3. **The wrong endpoint.** It probed `/emails`, but `raw_emails` is not
 *    selectable — `catalog.ts` offers `analytics_daily` and `analytics_totals`,
 *    and those are what customers get. They were not tested at all.
 *
 * A fourth, smaller: its `check()` took an OPTIONAL detail and three of its four
 * checks passed none, so a failure could not say what it saw. Here `observed` is
 * required, as in the other two scripts.
 *
 * THE RULE: **every parameter gets a CONTROL** — the same request without it,
 * comparing what came back. An accepted-and-ignored parameter and a working one
 * are indistinguishable in isolation. And the control has to match the
 * parameter's kind: a FILTER changes which records return (compare id sets), an
 * ORDERING changes only the sequence (compare sequences).
 *
 * No verdict strings. Measurements; a human decides.
 *
 * Read-only: every request is a GET.
 *
 *   INSTANTLY_API_KEY=xxx pnpm tsx scripts/verify-instantly.ts
 *
 * The key is a **v2** key: Instantly → Settings → Integrations → API.
 * (v1 keys stopped working 19 Jan 2026; a 401 here is the signature.)
 *
 * Env knobs: INSTANTLY_SKIP_TARGET (records the skip detector compares,
 * default 60), INSTANTLY_CAMPAIGN (pin a campaign id instead of the first one).
 */

const API = "https://api.instantly.ai/api/v2";

/** The connector's page size for the raw-email walk, mirrored from instantly.ts. */
const PAGE_LIMIT = 50;
/** The connector's default analytics window, mirrored from instantly.ts. */
const WINDOW_DAYS = 30;

/**
 * The skip detector takes a fixed PREFIX at two page sizes.
 *
 * Same shape as Calendly's CL8, and for the same reason: comparing "whatever
 * each walk reached" lets a short walk read as agreement, and a walk that never
 * paginated crossed no boundary and therefore cannot detect a cursor stepping
 * over one. Both walks stop after the same number of records, and a run that
 * could not paginate FAILS rather than passing.
 */
const SKIP_TARGET = Math.max(20, Number(process.env.INSTANTLY_SKIP_TARGET ?? 60) || 60);
const SKIP_PAGE_A = 10;
const SKIP_PAGE_B = 20;

type Rows = Array<Record<string, unknown>>;
type Page = { items?: Rows; next_starting_after?: string | null };
type Attempt = { ok: true; status: number; body: unknown } | { ok: false; status: number; body: string };

type Ev = { id: string; raw: string | null; ms: number | null };

const failures: string[] = [];
const findings: string[] = [];
let requests = 0;

function check(name: string, ok: boolean, observed: string): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}\n         observed: ${observed}`);
  if (!ok) failures.push(name);
}
function note(name: string, observed: string): void {
  console.log(`  [INFO] ${name}\n         observed: ${observed}`);
  findings.push(`${name} — ${observed}`);
}
function skip(name: string, why: string): void {
  console.log(`  [SKIP] ${name}\n         ${why}`);
}
function head(title: string): void {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

function key(): string {
  const k = process.env.INSTANTLY_API_KEY;
  if (!k) {
    console.error("Set INSTANTLY_API_KEY (a v2 key: Instantly → Settings → Integrations → API) and re-run.");
    process.exit(2);
  }
  return k;
}

async function attempt(path: string, params: Record<string, string> = {}): Promise<Attempt> {
  const qs = new URLSearchParams(params).toString();
  requests += 1;
  const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
    headers: { authorization: `Bearer ${key()}` },
  });
  const text = await res.text();
  // NOT truncated — an error body is where a provider names the parameter it
  // rejected, and clipping it removes the answer.
  if (!res.ok) return { ok: false, status: res.status, body: text };
  try {
    return { ok: true, status: res.status, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, body: `unparseable JSON: ${text.slice(0, 400)}` };
  }
}

async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const a = await attempt(path, params);
  if (!a.ok) throw new Error(`HTTP ${a.status}: ${a.body}`);
  return a.body;
}

async function section<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    check(`${label} (could not run)`, false, e instanceof Error ? e.message : String(e));
    return null;
  }
}

const asRows = (v: unknown): Rows =>
  Array.isArray(v) ? (v as Rows) : Array.isArray((v as { items?: Rows })?.items) ? (v as { items: Rows }).items : [];

const emailPage = (v: unknown): Page => (v ?? {}) as Page;
const items = (p: Page): Rows => p.items ?? [];
const idsOf = (rows: Rows): string[] => rows.map((r) => String(r["id"] ?? r["uuid"] ?? ""));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/** Read a date field into `{id, raw, ms}` triples — parsing is a reported step. */
function evs(rows: Rows, field: string): Ev[] {
  return rows.map((r) => {
    const v = r[field];
    const raw = v == null ? null : typeof v === "string" ? v : `${JSON.stringify(v)} (not a string: ${typeof v})`;
    const parsed = typeof v === "string" ? Date.parse(v) : NaN;
    return { id: String(r["id"] ?? "(no id)"), raw, ms: Number.isFinite(parsed) ? parsed : null };
  });
}
const dated = (l: Ev[]) => l.filter((e) => e.ms != null);
type Order = "newest-first" | "oldest-first" | "all-equal" | "too-few-dates" | "MIXED";
function orderOf(l: Ev[]): Order {
  const ts = dated(l).map((e) => e.ms!);
  if (ts.length < 2) return "too-few-dates";
  if (ts.every((t) => t === ts[0])) return "all-equal";
  const desc = ts.every((t, i) => i === 0 || ts[i - 1] >= t);
  const asc = ts.every((t, i) => i === 0 || ts[i - 1] <= t);
  return desc ? "newest-first" : asc ? "oldest-first" : "MIXED";
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main(): Promise<void> {
  console.log("Instantly v2 — RAW EVIDENCE (read-only)");
  console.log(`skip detector: first ${SKIP_TARGET} emails at page size ${SKIP_PAGE_A} and ${SKIP_PAGE_B}\n`);

  // ═════════════════════════════════════════════════ the key, and the campaigns
  head("SECTION 0 — the key era, and the campaign census");
  const campaign = await section("campaigns", async () => {
    const a = await attempt("/campaigns", { limit: "100" });
    if (!a.ok) {
      check(
        "I0 the key is accepted (a 401 here means a v1-era key)",
        false,
        `HTTP ${a.status}: ${a.body}` + (a.status === 401 ? "  — v1 keys stopped working 19 Jan 2026; create a v2 key" : ""),
      );
      return null;
    }
    const rows = asRows(a.body);
    check("I0 the key is accepted", true, `${rows.length} campaign(s) returned`);
    const pinned = process.env.INSTANTLY_CAMPAIGN;
    const chosen = pinned ?? (rows[0] ? String(rows[0]["id"]) : null);
    note(
      "I0 campaign used for the analytics sections",
      chosen ? `${chosen}${pinned ? " (pinned via INSTANTLY_CAMPAIGN)" : " (first in the list)"}` : "none — no campaigns on this account",
    );
    return chosen;
  });

  /**
   * ════════════════════════════════════════════════════════════════════════
   * SECTIONS 1-4 cover `/emails`, which backs the `raw_emails` stream.
   *
   * That stream is NOT selectable — `catalog.ts` offers only `analytics_daily`
   * and `analytics_totals`, and its comment says raw_emails "cannot be chosen
   * again". So this half is verifying a path no new customer can reach; it is
   * here because the connector still serves pre-existing streams configured that
   * way, and because its walk is the one with the ordering dependence pinned in
   * `tests/connector-contract.test.ts`.
   * ════════════════════════════════════════════════════════════════════════
   */
  head("SECTION 1 — /emails page 1, and WHICH field it is ordered by");
  const page1 = await section("emails page 1", async () => {
    const p = emailPage(await get("/emails", { limit: String(PAGE_LIMIT) }));
    const rows = items(p);
    check(
      "I1 response carries items[] and a next_starting_after key",
      Array.isArray(p.items) && "next_starting_after" in p,
      `items is ${Array.isArray(p.items) ? `an array of ${rows.length}` : typeof p.items}; ` +
        `next_starting_after ${"next_starting_after" in p ? `present (${JSON.stringify(p.next_starting_after ?? null)})` : "ABSENT"}`,
    );
    // BOTH fields the connector reads, because Close's ordering claim was right
    // about the direction and wrong about the field for months — and the walk's
    // early exit (`pageAllBelowFloor`) depends on the answer.
    for (const field of ["timestamp_created", "timestamp_email"]) {
      const l = evs(rows, field);
      const absent = l.filter((e) => e.raw === null).length;
      note(
        `I2 ordering by ${field}`,
        `${orderOf(l)} over ${dated(l).length} dated rows (${absent} absent, ${l.length - dated(l).length - absent} unparseable)`,
      );
    }
    check("I3 limit is honoured", rows.length <= PAGE_LIMIT, `asked ${PAGE_LIMIT}, got ${rows.length}`);
    const over = await attempt("/emails", { limit: String(PAGE_LIMIT + 1) });
    note(
      `I3 limit=${PAGE_LIMIT + 1} (one past what the connector sends)`,
      over.ok ? `ACCEPTED, returned ${items(emailPage(over.body)).length}` : `REJECTED HTTP ${over.status}: ${over.body}`,
    );
    return p;
  });

  /**
   * SECTION 2 — IS THERE A DATE PARAMETER AT ALL?
   *
   * `pollRawEmails` sends `limit` and `campaign_id` and nothing else, then
   * filters by date in its own loop and stops the walk when a whole page falls
   * below the floor. That early exit is what makes the walk depend on
   * newest-first ordering. **If a server-side date bound exists, the loop and its
   * exit can both go** — the window becomes the provider's job and the ordering
   * dependence disappears with it.
   *
   * Nobody has ever asked. Several names and spellings are probed, each against
   * an unbounded control, because a parameter Instantly accepts and discards
   * looks exactly like one that works.
   */
  head("SECTION 2 — does /emails accept ANY date bound? (control on each)");
  await section("date parameter probe", async () => {
    if (!page1) return skip("I5 date parameters", "page 1 did not load");
    const rows = items(page1);
    const l = dated(evs(rows, "timestamp_created"));
    if (l.length < 2) return skip("I5 date parameters", `page 1 has ${l.length} dated rows; need 2 to bound between`);
    const lo = Math.min(...l.map((e) => e.ms!));
    const hi = Math.max(...l.map((e) => e.ms!));
    if (lo === hi) return skip("I5 date parameters", "every row on page 1 shares one timestamp");
    const midMs = lo + Math.floor((hi - lo) / 2);
    const control = new Set(idsOf(rows));
    console.log(`         page 1 span: ${new Date(lo).toISOString()} .. ${new Date(hi).toISOString()}`);
    console.log(`         bound value used below: ${new Date(midMs).toISOString()} (and ${ymd(new Date(midMs))} for date-only names)`);

    const isoValue = new Date(midMs).toISOString();
    const dayValue = ymd(new Date(midMs));
    const names: Array<[string, string]> = [
      ["start_date", dayValue],
      ["end_date", dayValue],
      ["from_date", isoValue],
      ["to_date", isoValue],
      ["created_after", isoValue],
      ["created_before", isoValue],
      ["after", isoValue],
      ["before", isoValue],
      ["since", isoValue],
      ["timestamp_created_gte", isoValue],
      ["timestamp_created_after", isoValue],
      ["updated_after", isoValue],
    ];
    for (const [name, value] of names) {
      const res = await attempt("/emails", { limit: String(PAGE_LIMIT), [name]: value });
      if (!res.ok) {
        note(`I5 ${name}`, `REJECTED HTTP ${res.status}: ${res.body.slice(0, 300)}`);
        continue;
      }
      const got = new Set(idsOf(items(emailPage(res.body))));
      note(
        `I5 ${name}=${value}`,
        `ACCEPTED, ${got.size} rows` +
          (sameSet(got, control)
            ? `   [IDENTICAL id set to no bound (${control.size}) — accepted and IGNORED]`
            : `   [id set DIFFERS from the unbounded control (${control.size}) — this parameter does something]`),
      );
    }
    note(
      "I5 what a hit would mean",
      "any name whose id set differs is a server-side bound: pollRawEmails' client-side floor loop and its " +
        "pageAllBelowFloor early exit could both be removed, and with them the newest-first ordering dependence " +
        "pinned in tests/connector-contract.test.ts",
    );
  });

  /**
   * SECTION 3 — THE SKIP DETECTOR, which the old script did not have.
   *
   * Its I4 checked that two pages do not overlap. That catches DUPLICATION. A
   * cursor stepping OVER records produces no duplicates whatsoever and passes it
   * clean, which is precisely the defect that has now been found three times in
   * three connectors. Two walks at different page sizes land their boundaries in
   * different places, so a record dropped at a boundary is dropped in only one
   * of them and the id sets stop matching.
   */
  head("SECTION 3 — does `starting_after` step OVER records?");
  await section("skip detection", async () => {
    const walk = async (limit: number, target: number) => {
      const seen = new Map<string, Record<string, unknown>>();
      const duplicates: string[] = [];
      let after: string | null = null;
      let pages = 0;
      while (seen.size < target && pages < Math.ceil(target / limit) + 2) {
        const params: Record<string, string> = { limit: String(limit) };
        if (after) params.starting_after = after;
        const p = emailPage(await get("/emails", params));
        pages += 1;
        const rows = items(p);
        for (const r of rows) {
          const id = String(r["id"]);
          if (seen.has(id)) duplicates.push(id);
          else if (seen.size < target) seen.set(id, r);
        }
        after = p.next_starting_after ?? null;
        if (!after || rows.length === 0) break;
      }
      return { seen, duplicates, pages };
    };

    const a = await walk(SKIP_PAGE_A, SKIP_TARGET);
    const b = await walk(SKIP_PAGE_B, SKIP_TARGET);

    const paged = a.pages >= 2 && b.pages >= 2;
    check(
      "I4 both walks actually paginated (a single-page walk tests nothing)",
      paged,
      `page size ${SKIP_PAGE_A}: ${a.pages} page(s), ${a.seen.size} records; ` +
        `page size ${SKIP_PAGE_B}: ${b.pages} page(s), ${b.seen.size} records` +
        (paged
          ? ""
          : `  — this account has too few emails to have a page boundary, so the skip question was NOT asked. ` +
            `Lower INSTANTLY_SKIP_TARGET only if you also lower the page sizes; otherwise there is nothing to test here yet.`),
    );
    check(
      "I4 no email returned twice within a walk",
      a.duplicates.length === 0 && b.duplicates.length === 0,
      `${a.duplicates.length} duplicate(s) at limit=${SKIP_PAGE_A}, ${b.duplicates.length} at limit=${SKIP_PAGE_B}`,
    );
    if (!paged || a.seen.size !== b.seen.size) {
      return skip(
        "I4 two page sizes see the same records",
        `walks covered ${a.seen.size} and ${b.seen.size} records — not comparable`,
      );
    }
    const onlyA = [...a.seen.keys()].filter((id) => !b.seen.has(id));
    const onlyB = [...b.seen.keys()].filter((id) => !a.seen.has(id));
    check(
      "I4 two page sizes over the same prefix see the same records",
      onlyA.length === 0 && onlyB.length === 0,
      `${a.seen.size} records each, ${a.pages} vs ${b.pages} pages; ` +
        `${onlyA.length} seen only at limit=${SKIP_PAGE_A}, ${onlyB.length} only at limit=${SKIP_PAGE_B}`,
    );
    for (const id of [...onlyA, ...onlyB].slice(0, 10)) console.log(`           only one walk saw: ${id}`);
  });

  /**
   * ════════════════════════════════════════════════════════════════════════
   * SECTIONS 4-5 — THE STREAMS CUSTOMERS ACTUALLY GET.
   *
   * `analytics_daily` and `analytics_totals` are the two options `catalog.ts`
   * offers, and the old script tested neither. Both are derived-mirrors: they
   * return numbers Instantly computed, re-read on a schedule and refreshed in
   * place, so the questions are different from a cursor walk — does the window
   * bound, and is the campaign filter real.
   * ════════════════════════════════════════════════════════════════════════
   */
  head("SECTION 4 — analytics_daily: does the window bound, and is campaign_id honoured?");
  await section("daily analytics", async () => {
    if (!campaign) return skip("I6 analytics_daily", "no campaign available on this account");
    const to = new Date();
    const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);
    const narrowFrom = new Date(to.getTime() - 3 * 86_400_000);

    const full = await attempt("/campaigns/analytics/daily", {
      campaign_id: campaign,
      start_date: ymd(from),
      end_date: ymd(to),
      exclude_total_leads_count: "true",
    });
    if (!full.ok) return note("I6 analytics_daily", `REJECTED HTTP ${full.status}: ${full.body}`);
    const fullRows = asRows(full.body);
    note("I6 the request the connector sends", `${WINDOW_DAYS}-day window returned ${fullRows.length} row(s)`);

    // Does `start_date` bound? A 3-day window must return fewer rows than 30.
    const narrow = await attempt("/campaigns/analytics/daily", {
      campaign_id: campaign,
      start_date: ymd(narrowFrom),
      end_date: ymd(to),
      exclude_total_leads_count: "true",
    });
    if (narrow.ok) {
      const narrowRows = asRows(narrow.body);
      note(
        "I6 start_date/end_date bound the window",
        `30-day window ${fullRows.length} rows vs 3-day window ${narrowRows.length} rows` +
          (fullRows.length === narrowRows.length
            ? "   [IDENTICAL counts — the window may be accepted and IGNORED, which would make `days` decorative]"
            : "   [narrowing the window returned fewer rows]"),
      );
    }

    // Is `campaign_id` honoured, or does it return the whole workspace? This is
    // the same question `probeCampaignScoping` asks from production logs.
    const noCampaign = await attempt("/campaigns/analytics/daily", {
      start_date: ymd(from),
      end_date: ymd(to),
      exclude_total_leads_count: "true",
    });
    note(
      "I6 campaign_id — request WITHOUT it, as the control",
      noCampaign.ok
        ? `${asRows(noCampaign.body).length} row(s) with no campaign_id vs ${fullRows.length} with it` +
          (asRows(noCampaign.body).length === fullRows.length
            ? "   [same count — either one campaign exists, or the filter is ignored; check the ids below]"
            : "")
        : `REJECTED HTTP ${noCampaign.status}: ${noCampaign.body.slice(0, 300)}   [campaign_id appears required]`,
    );
    const ids = new Set(fullRows.map((r) => String(r["campaign_id"] ?? r["campaign"] ?? "")).filter(Boolean));
    note(
      "I6 campaign ids echoed in the filtered response",
      ids.size === 0
        ? "the endpoint does not echo a campaign id — scoping cannot be confirmed from the rows"
        : [...ids].every((id) => id === campaign)
          ? `every row carries the requested campaign (${campaign})`
          : `FOREIGN ids present: ${[...ids].slice(0, 5).join(", ")} — the campaign_id filter is not scoping`,
    );
    // What the connector stores wholesale, so a field vanishing is visible.
    if (fullRows[0]) note("I6 fields on a daily row", Object.keys(fullRows[0]).sort().join(", "));
  });

  head("SECTION 5 — analytics_totals: shape and scoping");
  await section("campaign totals", async () => {
    if (!campaign) return skip("I7 analytics_totals", "no campaign available on this account");
    const res = await attempt("/campaigns/analytics", { campaign_id: campaign, exclude_total_leads_count: "true" });
    if (!res.ok) return note("I7 analytics_totals", `REJECTED HTTP ${res.status}: ${res.body}`);
    const rows = asRows(res.body);
    note("I7 rows returned for one campaign", `${rows.length} (the connector reads rows[0] and ignores any others)`);
    if (rows[0]) {
      note("I7 fields on a totals row", Object.keys(rows[0]).sort().join(", "));
      // The connector dates this row from created_at / campaign_created_at and
      // falls back to first-seen. Whether either field exists decides which.
      const hasDate = ["created_at", "campaign_created_at"].filter((f) => rows[0][f] != null);
      note(
        "I7 the field that dates a totals row",
        hasDate.length > 0
          ? `${hasDate.join(", ")} present`
          : "NEITHER created_at nor campaign_created_at — every totals row falls back to first-seen time",
      );
    }
    const all = await attempt("/campaigns/analytics", { exclude_total_leads_count: "true" });
    note(
      "I7 campaign_id — request WITHOUT it, as the control",
      all.ok
        ? `${asRows(all.body).length} row(s) unfiltered vs ${rows.length} filtered`
        : `REJECTED HTTP ${all.status}: ${all.body.slice(0, 300)}`,
    );
  });

  report();
}

function report(): void {
  head("SUMMARY");
  console.log(`  ${requests} GET requests issued (read-only).`);
  if (findings.length > 0) {
    console.log("\n  Measurements (no pass/fail meaning — read them):");
    for (const f of findings) console.log(`    - ${f}`);
  }
  console.log(
    failures.length === 0
      ? "\n  Nothing contradicted the contract pinned in src/connectors/instantly.ts.\n" +
          "  The INFO lines are the point: an IGNORED parameter is reported there, not\n" +
          "  here, because a provider quietly not filtering returns 200 and a plausible page."
      : `\n  ${failures.length} check(s) FAILED:\n${failures.map((f) => `    - ${f}`).join("\n")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Makes this file a MODULE rather than a global script.
 *
 * Without it, TypeScript puts every top-level name here — `API`, `check`,
 * `Attempt`, `section` — into the shared global scope, where it collides with
 * the next verification script somebody writes. `verify-calendly.ts` typechecked
 * cleanly only because it was briefly the only non-module script in `scripts/`;
 * adding `verify-instantly.ts` beside it broke both at once.
 */
export {};
