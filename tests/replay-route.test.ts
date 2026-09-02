import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb, seedConnection } from "./helpers/testdb";
import { storeRawEvent } from "@/ingestion/raw-store";
import { deadLetterRawEvent } from "@/ingestion/pipeline";
import type { DB } from "@/db/types";

/**
 * C.10 — a successful replay through the API must kick a recompute.
 *
 * `replayRawEvent` repairs the data and marks dependent tiles stale, but
 * nothing recomputed them until this fired — the blind ten-minute sweep that
 * used to paper over that is gone, so a repaired payment sat "fixed" in the
 * DB while its tile kept serving the old number until the next age-backstop
 * sweep. This sends the SAME debounced signal a fresh webhook uses
 * (`flow/recompute.requested`, per-org), best-effort, only once the replay
 * has actually succeeded.
 */

let db: DB;
let close: () => Promise<void>;
let ctx: { orgId: string; userId: string; role?: string } | null = { orgId: "org_test", userId: "user_1" };

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("@/lib/auth", () => ({ getOrgContext: async () => ctx }));

const sent: Array<{ name: string; data: Record<string, unknown> }> = [];
let sendShouldFail = false;
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: async (e: { name: string; data: Record<string, unknown> }) => {
      if (sendShouldFail) throw new Error("inngest unreachable");
      sent.push(e);
    },
  },
}));

const { POST } = await import("@/app/api/replay/route");

const post = (body: unknown) =>
  POST(new Request("https://app.example/api/replay", { method: "POST", body: JSON.stringify(body) }));

async function seedDeadLetteredRaw(): Promise<string> {
  const connectionId = await seedConnection(db, { orgId: "org_test" });
  const raw = await storeRawEvent(db, {
    orgId: "org_test",
    connectionId,
    source: "webhook",
    headers: {},
    payload: { id: "e1", type: "booked" },
    signatureValid: true,
  });
  await deadLetterRawEvent(db, raw.id, 3, "transient outage");
  return raw.id;
}

beforeEach(async () => {
  sent.length = 0;
  sendShouldFail = false;
  ctx = { orgId: "org_test", userId: "user_1" };
  ({ db, close } = await createTestDb());
});
afterEach(async () => {
  await close();
});

describe("POST /api/replay", () => {
  it("kicks a debounced recompute for the org after a successful replay", async () => {
    const rawEventId = await seedDeadLetteredRaw();

    const res = await post({ rawEventId });

    expect(res.status).toBe(200);
    const recomputes = sent.filter((e) => e.name === "flow/recompute.requested");
    expect(recomputes).toHaveLength(1);
    expect(recomputes[0].data).toEqual({ orgId: "org_test" });
  });

  it("does not kick a recompute when the replay fails", async () => {
    // No such raw event — replayRawEvent throws, the route responds 500.
    const res = await post({ rawEventId: "00000000-0000-0000-0000-000000000000" });

    expect(res.status).toBe(500);
    expect(sent.filter((e) => e.name === "flow/recompute.requested")).toHaveLength(0);
  });

  it("a failed recompute kick does not fail the replay response (best-effort)", async () => {
    const rawEventId = await seedDeadLetteredRaw();
    sendShouldFail = true;

    const res = await post({ rawEventId });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
