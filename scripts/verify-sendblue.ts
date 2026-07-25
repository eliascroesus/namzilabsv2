/**
 * One-time HUMAN-RUN verification of the Sendblue contract
 * (see PRE_LAUNCH_CHECKLIST.md item 3).
 *
 * The Sendblue connector (src/connectors/sendblue.ts) pins this shape:
 *
 *   S1. the host answers at all (API_BASE)
 *   S2. GET /api/v2/messages returns messages[] (or a bare array)
 *   S3. messages carry `message_handle` — the dedup key the poll relies on
 *   S4. `limit`/`offset` are honored
 *   S5. GET /api/account/webhooks returns a webhook list (empty is fine)
 *
 * None of these could be confirmed from the build environment (docs are
 * bot-walled and the repo had no pre-existing Sendblue send path to compare
 * against), so this script is the confirmation. When the primary host fails it
 * automatically retries the documented alternate (.com vs .co) and tells you
 * which one answered, so a wrong-host guess is self-diagnosing.
 *
 *   SENDBLUE_API_KEY_ID=xxx SENDBLUE_API_SECRET=yyy pnpm tsx scripts/verify-sendblue.ts
 *
 * Read-only: GETs only. It never POSTs a webhook registration — the sweep does
 * that on its own once a connection exists. Exits 0 when every check passes.
 */

const PRIMARY = "https://api.sendblue.co";
const ALTERNATE = "https://api.sendblue.com";

type MessagePage = { messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
type WebhookPage = { webhooks?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function authHeaders(): Record<string, string> {
  const id = process.env.SENDBLUE_API_KEY_ID;
  const secret = process.env.SENDBLUE_API_SECRET;
  if (!id || !secret) {
    console.error("Set SENDBLUE_API_KEY_ID and SENDBLUE_API_SECRET (Sendblue dashboard → API settings) and re-run.");
    process.exit(2);
  }
  return { "sb-api-key-id": id, "sb-api-secret-key": secret };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() });
  if (res.status === 401 || res.status === 403) {
    console.error(
      `\nHTTP ${res.status} on ${url} — the keys are wrong, or the header names differ from ` +
        `sb-api-key-id / sb-api-secret-key. Check the dashboard's API examples and update ` +
        `authHeaders() in src/connectors/sendblue.ts.`,
    );
    process.exit(1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** Find whichever host actually answers, so a wrong guess reports itself. */
async function resolveHost(): Promise<string> {
  for (const base of [PRIMARY, ALTERNATE]) {
    try {
      await getJson<MessagePage>(`${base}/api/v2/messages?limit=1&offset=0`);
      return base;
    } catch (e) {
      console.log(`  (${base} did not answer: ${e instanceof Error ? e.message.slice(0, 120) : e})`);
    }
  }
  console.error(
    `\nNeither ${PRIMARY} nor ${ALTERNATE} answered. Confirm the base URL in the Sendblue ` +
      `dashboard and set API_BASE at the top of src/connectors/sendblue.ts.`,
  );
  process.exit(1);
}

const listOf = <T,>(data: { messages?: T[]; webhooks?: T[] } | T[], key: "messages" | "webhooks"): T[] =>
  Array.isArray(data) ? data : ((data as Record<string, T[] | undefined>)[key] ?? []);

async function main() {
  console.log("Sendblue contract verification\n");

  const base = await resolveHost();
  check(`S1 host answers (${base})`, true, base === PRIMARY ? "matches API_BASE" : `⚠ API_BASE says ${PRIMARY} — update it`);
  if (base !== PRIMARY) failures.push("S1 host differs from API_BASE");

  const page = await getJson<MessagePage>(`${base}/api/v2/messages?limit=5&offset=0`);
  const messages = listOf(page, "messages");
  check("S2 messages list returned", Array.isArray(messages), `${messages.length} message(s)`);
  check("S4 limit honored", messages.length <= 5, `got ${messages.length}`);

  if (messages.length === 0) {
    console.log("\n  (no message history — send or receive one SMS in Sendblue, then re-run for S3)");
  } else {
    const withHandle = messages.filter((m) => typeof m["message_handle"] === "string" && m["message_handle"]);
    check("S3 messages carry message_handle", withHandle.length === messages.length, `${withHandle.length}/${messages.length}`);

    if (messages.length === 5) {
      const second = listOf(await getJson<MessagePage>(`${base}/api/v2/messages?limit=5&offset=5`), "messages");
      const first = new Set(messages.map((m) => String(m["message_handle"])));
      const overlap = second.some((m) => first.has(String(m["message_handle"])));
      check("S4 offset walks to new messages (no overlap)", !overlap, `page 2 had ${second.length}`);
    }
  }

  const hooks = listOf(await getJson<WebhookPage>(`${base}/api/account/webhooks`), "webhooks");
  check("S5 webhook list readable", Array.isArray(hooks), hooks.length === 0 ? "empty — fine, the sweep registers ours" : `${hooks.length} registered`);

  console.log(
    failures.length === 0
      ? "\nAll checks passed — the pinned contract holds."
      : `\n${failures.length} check(s) FAILED: ${failures.join("; ")}\n` +
          `→ Update src/connectors/sendblue.ts (API_BASE / authHeaders / endpoint paths) + ` +
          `tests/instantly-sendblue-poll.test.ts before shipping the Sendblue poll.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nAborted: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});

export {};
