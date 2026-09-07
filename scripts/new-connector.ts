/**
 * Scaffold a connector: module on the kit, catalog entry, registry line,
 * test file, live prober. Usage:
 *   pnpm connector:new <source> --name "<Name>" --auth apiKey|secret|oauth [--instant] [--poll] [--stream <fieldKey>]
 * Writes src/connectors/<source>.ts, tests/<source>.test.ts, scripts/verify-<source>.ts,
 * and PRINTS the catalog entry and registry line for you to paste — those two files
 * carry hand-written prose around every entry, so a script does not edit them.
 */
import { writeFileSync, existsSync } from "node:fs";

export type ScaffoldInput = {
  source: string;
  name: string;
  auth: "apiKey" | "secret" | "oauth";
  instant: boolean;
  poll: boolean;
  stream: string | null;
  today: string;
};

const pascal = (s: string) => s.replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase());

export function renderScaffold(i: ScaffoldInput): Record<string, string> {
  const Name = pascal(i.source);
  const authType = i.auth === "oauth" ? "oauth2" : i.auth;
  const envKey = i.source.toUpperCase().replace(/-/g, "_");
  const credentialFields =
    i.auth === "apiKey"
      ? `[{ key: "apiKey", label: "API key", placeholder: "…" }${i.instant ? `, { key: "webhookSecret", label: "Webhook signing secret (optional)", placeholder: "whsec_…" }` : ""}]`
      : i.auth === "secret"
        ? `[{ key: "webhookSecret", label: "Webhook signing secret", placeholder: "…" }]`
        : "[]";
  const flowFields = i.stream
    ? `
    flowFields: [
      { key: "${i.stream}", label: "${pascal(i.stream)}", required: true, dynamic: true, placeholder: "Choose…" },
    ],`
    : "";

  const typeImports = ["Connector", "CanonicalEvent", "VerifyArgs", "NormalizeContext", "PollArgs", "PollResult", ...(i.stream ? ["ListOptionsArgs", "SourceOption"] : [])];
  const connector = `import type { ${typeImports.join(", ")} } from "./types";
import { asObject, str } from "./field-utils";
import { bearerClient, eventId, hmacHeaderVerify, isoOrNull, parseDate, requireCredential, windowedWalk } from "./kit";

/**
 * ${i.name}. Facts below were read from the provider's documentation on ${i.today};
 * each one is cited on the catalog entry. Nothing here has been probed live yet
 * (\`verified.live: null\`) — run \`scripts/verify-${i.source}.ts\` with a key and record the date.
 */
const API = "https://api.example.com/v1"; // FILL-ME: base URL from the docs
const DEFAULTS = { pagesPerPoll: 3, maxPagesPerPoll: 20, firstSyncDays: 30, overlapMs: 5 * 60_000 };

const EVENT_TYPES: Record<string, string> = {
  // "provider.event.name": "our_event_type",
};

function client(credentials?: Record<string, unknown> | null) {
  return bearerClient(API, requireCredential(credentials, "apiKey", "${i.name}"), "${i.name}");
}

function toCanonical(row: Record<string, unknown>, connectionId: string, fallback?: Date): CanonicalEvent | null {
  const id = str(row["id"]);
  if (!id) return null;
  const type = str(row["type"]) ?? "event";
  return {
    eventId: eventId("${i.source}", connectionId, id),
    eventType: EVENT_TYPES[type] ?? type,
    subject: str(row["email"]) ?? null,
    occurredAt: parseDate(str(row["created_at"]), "created_at") ?? fallback ?? new Date(),
    properties: row,
  };
}

export const ${Name}Connector: Connector = {
  source: "${i.source}",
  authType: "${authType}",
  verifySignature({ rawBody, headers, secret }: VerifyArgs): boolean {
    if (!secret) return false;
    return hmacHeaderVerify({ rawBody, headers, secret }, { header: "x-signature", encoding: "hex" }); // FILL-ME: the provider's scheme
  },
${
  i.instant
    ? `  normalize(rawPayload: unknown, ctx: NormalizeContext): CanonicalEvent[] {
    const body = asObject(rawPayload);
    const ev = toCanonical(body, ctx.connectionId, ctx.fallbackOccurredAt);
    return ev ? [ev] : [];
  },
`
    : ""
}${
  i.poll
    ? `  async poll(args: PollArgs): Promise<PollResult> {
    const api = client(args.credentials);
    return windowedWalk<Record<string, unknown>>({
      cursor: args.cursor,
      budget: args.budget,
      windowFloor: args.windowFloor,
      defaults: DEFAULTS,
      fetchPage: async ({ since, cont }) => {
        const page = await api.get<{ data?: unknown[]; next_cursor?: string | null }>("/events", {
          updated_after: since.toISOString(), // FILL-ME: the provider's filter param
          limit: 100,
          cursor: cont ?? undefined,
        });
        return { rows: (page.data ?? []).map(asObject), next: page.next_cursor ?? null, rateLimit: api.rateLimit() };
      },
      changedAt: (r) => isoOrNull(r["updated_at"]),
      happenedAt: (r) => isoOrNull(r["created_at"]),
      map: (r) => toCanonical(r, args.connectionId),
    });
  },
  async testFetchLatest(n: number, args: PollArgs): Promise<CanonicalEvent[]> {
    const { records } = await this.poll!({ ...args, cursor: null, budget: { maxCalls: 1 } });
    return records.slice(0, n);
  },
`
    : ""
}${
  i.stream
    ? `  async listOptions(key: string, args: ListOptionsArgs): Promise<SourceOption[]> {
    if (key !== "${i.stream}") return [];
    const api = client(args.credentials);
    const res = await api.get<{ data?: unknown[] }>("/resources"); // FILL-ME
    return (res.data ?? []).map(asObject).map((r) => ({ value: str(r["id"]) ?? "", label: str(r["name"]) ?? str(r["id"]) ?? "Untitled" })).filter((o) => o.value);
  },
`
    : ""
}  operations: ["api.request"] as const,
  operationFor: () => "api.request",
};
`;

  const catalog = `  {
    source: "${i.source}",
    name: "${i.name}",
    description: "FILL-ME: one sentence, the events a customer counts with it.",
    brand: { color: "#64748B", short: "${Name.slice(0, 2)}" },
    connect: "${i.auth === "oauth" ? "oauth" : "apiKey"}",${i.auth === "oauth" ? `\n    oauthProvider: "${i.source}",` : ""}
    instant: ${i.instant},
    poll: ${i.poll},
    autoWebhook: false,
    docs: { url: "https://FILL-ME", readOn: "FILL-ME", webhooks: "https://FILL-ME" },
    verified: { live: null },
    // Cite the page and date for every figure. Declared on "api.request" because
    // the provider publishes one account-wide limit; split per endpoint if it does not.
    rateLimits: { "api.request": { requestsPerMinute: 60 } },
    credentialFields: ${credentialFields},${flowFields}
  },`;

  const registry = `import { ${Name}Connector } from "./${i.source}";\n  ${Name}Connector,`;

  const test = `import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { ${Name}Connector } from "@/connectors/${i.source}";
import { catalogEntry } from "@/connectors/catalog";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";
const SECRET = "s3cret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");

describe("${i.name}: signature", () => {
  it("accepts a correctly signed delivery and fails closed otherwise", () => {
    const body = JSON.stringify({ id: "e1", type: "event", created_at: "2026-09-01T10:00:00Z" });
    expect(${Name}Connector.verifySignature({ rawBody: body, headers: { "x-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(${Name}Connector.verifySignature({ rawBody: body, headers: { "x-signature": sign(body) }, secret: null })).toBe(false);
    expect(${Name}Connector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    expect(${Name}Connector.verifySignature({ rawBody: body + " ", headers: { "x-signature": sign(body) }, secret: SECRET })).toBe(false);
  });
});
${
  i.instant
    ? `
describe("${i.name}: normalize", () => {
  it("maps a delivery to a dated, namespaced event", () => {
    const [ev] = ${Name}Connector.normalize!({ id: "e1", type: "event", email: "a@b.io", created_at: "2026-09-01T10:00:00Z" }, { connectionId: CONN });
    expect(ev.eventId).toBe("${i.source}:conn_1:e1");
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(ev.subject).toBe("a@b.io");
  });
});
`
    : ""
}${
  i.poll
    ? `
describe("${i.name}: poll", () => {
  it("walks pages under the budget and settles to a high-water mark", async () => {
    const rows = Array.from({ length: 3 }, (_, n) => ({ id: \`r\${n}\`, type: "event", created_at: \`2026-09-0\${n + 1}T10:00:00Z\`, updated_at: \`2026-09-0\${n + 1}T10:00:00Z\` }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", headers: { get: () => null }, json: async () => ({ data: rows, next_cursor: null }), text: async () => "" })));
    const res = await ${Name}Connector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" } });
    expect(res.records).toHaveLength(3);
    expect(res.nextCursor).toBe("2026-09-03T10:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
  });
});
`
    : ""
}
describe("${i.name}: catalog", () => {
  it("is registered with provenance", () => {
    const e = catalogEntry("${i.source}")!;
    expect(e.docs?.readOn).toMatch(/^\\d{4}-\\d{2}-\\d{2}$/);
    expect(e.verified).toEqual({ live: null });
  });
});
`;

  const prober = `/**
 * Live prober for ${i.name}. Prints measurements; asserts only comparisons
 * between its own responses. Run: ${envKey}_API_KEY=… pnpm tsx scripts/verify-${i.source}.ts
 */
import { createProbe, attemptJson, requireEnv } from "./lib/probe";

const API = "https://api.example.com/v1"; // FILL-ME: keep in step with src/connectors/${i.source}.ts
const probe = createProbe("${i.name}");
const key = requireEnv("${envKey}_API_KEY", "an API key for a test account");
const headers = { authorization: \`Bearer \${key}\` };

async function main() {
  probe.head("SECTION 1 — the list endpoint answers");
  const page = await probe.section("list", () => attemptJson(probe, \`\${API}/events?limit=5\`, { headers }));
  if (page) probe.check("list endpoint responds 2xx", page.ok, \`HTTP \${page.status}\`);

  probe.head("SECTION 2 — does the date filter FILTER? (bounded vs unbounded control)");
  const all = await probe.section("unbounded", () => attemptJson(probe, \`\${API}/events?limit=50\`, { headers }));
  const bounded = await probe.section("bounded", () => attemptJson(probe, \`\${API}/events?limit=50&updated_after=2030-01-01T00:00:00Z\`, { headers }));
  if (all?.ok && bounded?.ok) {
    const n = (x: unknown) => (Array.isArray((x as { data?: unknown[] })?.data) ? (x as { data: unknown[] }).data.length : -1);
    probe.check("a future bound returns fewer rows than no bound (the parameter is honoured)", n(bounded.body) < n(all.body), \`unbounded=\${n(all.body)} bounded=\${n(bounded.body)}\`);
  }

  probe.head("SECTION 3 — rate-limit headers");
  const res = await fetch(\`\${API}/events?limit=1\`, { headers });
  probe.bump();
  probe.note("headers", [...res.headers.entries()].filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => \`\${k}=\${v}\`).join(", ") || "none");
  probe.report();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
`;

  return {
    [`src/connectors/${i.source}.ts`]: connector,
    [`tests/${i.source}.test.ts`]: test,
    [`scripts/verify-${i.source}.ts`]: prober,
    "catalog-entry.txt": catalog,
    "registry-line.txt": registry,
  };
}

function parseArgs(argv: string[]): ScaffoldInput {
  const [source, ...rest] = argv;
  if (!source || !/^[a-z][a-z0-9-]*$/.test(source)) {
    console.error("usage: pnpm connector:new <source> --name <Name> --auth apiKey|secret|oauth [--instant] [--poll] [--stream <fieldKey>]");
    process.exit(2);
  }
  const flag = (k: string) => {
    const i = rest.indexOf(k);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const auth = (flag("--auth") ?? "apiKey") as ScaffoldInput["auth"];
  if (!["apiKey", "secret", "oauth"].includes(auth)) {
    console.error("--auth must be apiKey, secret or oauth");
    process.exit(2);
  }
  return {
    source,
    name: flag("--name") ?? source,
    auth,
    instant: rest.includes("--instant"),
    poll: rest.includes("--poll"),
    stream: flag("--stream") ?? null,
    today: new Date().toISOString().slice(0, 10),
  };
}

if (process.argv[1]?.endsWith("new-connector.ts")) {
  const input = parseArgs(process.argv.slice(2));
  const files = renderScaffold(input);
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith(".txt")) continue;
    if (existsSync(path)) {
      console.error(`${path} exists — refusing to overwrite`);
      process.exit(1);
    }
    writeFileSync(path, content);
    console.log(`wrote ${path}`);
  }
  console.log("\nPaste into CONNECTOR_CATALOG (src/connectors/catalog.ts):\n" + files["catalog-entry.txt"]);
  console.log("\nAdd to src/connectors/registry.ts (import, then the array):\n" + files["registry-line.txt"]);
  console.log("\nThen: replace every FILL-ME, run the tests, and run pnpm check:orphans.");
}
