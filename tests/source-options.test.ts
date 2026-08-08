import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { createTestDb } from "./helpers/testdb";
import { connections, usageLedger } from "@/db/schema";
import { encrypt, getEncryptionKey } from "@/lib/crypto";
import { claimCalls } from "@/lib/provider-gateway/budget";
import { listSourceOptions } from "@/lib/flow/source-options";
import type { DB } from "@/db/types";

/**
 * The options path's three contracts, over real SQL:
 *
 * 1. THE GATE IS THE CONNECTOR, NOT THE SCOPE. The old
 *    `isStreamScoped` gate returned [] for every connection-scoped source —
 *    which is exactly the shape Close's Pipeline picker has. The end-to-end
 *    case here returned [] before that gate was removed; it is the sabotage
 *    pin for putting it back.
 * 2. TENANT WALL: a connection id from another org answers "not found",
 *    never options.
 * 3. BUDGETED AT LAST: these pickers were the one provider-hitting path with
 *    no claim behind them. A successful call books a ledger row; an exhausted
 *    minute answers a denial that rides the panel's free-text degradation.
 */

let db: DB;
let close: () => Promise<void>;

vi.mock("server-only", () => ({}));

const ORG = "org_opts";

async function seedClose(orgId = ORG): Promise<{ id: string; orgId: string; source: string }> {
  const [row] = await db
    .insert(connections)
    .values({
      orgId,
      source: "close",
      name: "Close",
      status: "active",
      authType: "apiKey",
      credentialsEncrypted: encrypt(JSON.stringify({ apiKey: "k" }), getEncryptionKey()),
    })
    .returning({ id: connections.id });
  return { id: row.id, orgId, source: "close" };
}

const pipelineFetch = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => ({ data: [{ id: "pipe_1", name: "Sales" }] }),
    text: async () => "",
  }) as unknown as Response);

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

describe("listSourceOptions", () => {
  it("lists a CONNECTION-scoped source's options end-to-end and books the call in the ledger", async () => {
    const conn = await seedClose();
    vi.stubGlobal("fetch", pipelineFetch());

    const res = await listSourceOptions(db, ORG, conn.id, "pipelineId", {});

    // Before the gate fix this exact call was `{ok: true, options: []}`.
    expect(res).toEqual({ ok: true, options: [{ value: "pipe_1", label: "Sales" }] });
    const [{ n }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(usageLedger)) as Array<{ n: number }>;
    expect(Number(n)).toBeGreaterThan(0); // the claim exists — remove it and this is 0
  });

  it("answers 'not found' across the tenant wall, without touching the provider", async () => {
    const foreign = await seedClose("org_other");
    const fetchMock = pipelineFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await listSourceOptions(db, ORG, foreign.id, "pipelineId", {});

    expect(res).toEqual({ ok: false, error: "Connection not found." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("defers when the minute's budget is spent — a denial, not an unledgered call", async () => {
    const conn = await seedClose();
    const fetchMock = pipelineFetch();
    vi.stubGlobal("fetch", fetchMock);
    // Drain the interactive lane's whole minute (DEFAULT_RPM 60 × 0.7 = 42).
    const drain = await claimCalls(db, conn, "*", 42, new Date(), "interactive");
    expect(drain.allowed).toBe(true);

    const res = await listSourceOptions(db, ORG, conn.id, "pipelineId", {});

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a PAUSED connection is refused before any provider call — the pause binds every path", async () => {
    // The claim alone cannot enforce this: paused sweeps leave the minute's
    // buckets empty, so a claim would succeed inside the provider's declared
    // cool-off. Remove the isPaused check and this fires a real request.
    const conn = await seedClose();
    await db
      .update(connections)
      .set({ pausedUntil: new Date(Date.now() + 10 * 60_000), pausedReason: "close rate limited (429) — resumes automatically" })
      .where(sql`${connections.id} = ${conn.id}`);
    const fetchMock = pipelineFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await listSourceOptions(db, ORG, conn.id, "pipelineId", {});

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("paused");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a source with no listOptions answers an empty list, not an error", async () => {
    const [row] = await db
      .insert(connections)
      .values({ orgId: ORG, source: "webhook", name: "Hook", status: "active", authType: "secret" })
      .returning({ id: connections.id });

    const res = await listSourceOptions(db, ORG, row.id, "anything", {});

    expect(res).toEqual({ ok: true, options: [] });
  });
});
