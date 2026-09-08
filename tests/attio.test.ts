import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { attioConnector, attioRecordEvents, ATTIO_SUBSCRIPTIONS } from "@/connectors/attio";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";

/** A fetch stub that answers a queue of JSON bodies in order and records every request. */
function stubFetch(bodies: unknown[], headers: Record<string, string> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const body = bodies[Math.min(i++, bodies.length - 1)];
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

/** The same, refusing with a status — for the teardown that must treat 404 as success. */
function stubStatus(status: number) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return {
        ok: false,
        status,
        statusText: "Not Found",
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    }),
  );
  return calls;
}

const SECRET = "attio_secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");

/**
 * Fixtures in Attio's own shapes: nanosecond-precision timestamps, every
 * attribute an array of values, currency as a STRING in major units.
 */
const deal = (over: Record<string, unknown> = {}) => ({
  id: { workspace_id: "ws", object_id: "obj_deals", record_id: "rec_1" },
  created_at: "2026-09-01T10:00:00.000000000Z",
  web_url: "https://app.attio.com/x/deals/rec_1",
  values: {
    name: [{ attribute_type: "text", value: "Acme expansion" }],
    value: [{ attribute_type: "currency", currency_value: "1200.00", currency_code: "usd" }],
    stage: [{ attribute_type: "status", active_from: "2026-09-02T09:00:00.000000000Z", active_until: null, status: { title: "In Progress" } }],
  },
  ...over,
});

const person = (over: Record<string, unknown> = {}) => ({
  id: { workspace_id: "ws", object_id: "obj_people", record_id: "rec_p" },
  created_at: "2026-09-01T08:00:00.000000000Z",
  values: {
    name: [{ attribute_type: "personal-name", first_name: "Ada", last_name: "Lovelace", full_name: "Ada Lovelace" }],
    email_addresses: [{ attribute_type: "email-address", email_address: "ada@x.io", email_domain: "x.io" }],
  },
  ...over,
});

describe("attio: registration", () => {
  it("is in the catalog and the registry with dated provenance, stream-scoped on the object", () => {
    expect(getConnector("attio")).toBe(attioConnector);
    const e = catalogEntry("attio")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.brand).toEqual({ color: "#266DF0", short: "Ao" });
    expect(e.flowFields?.map((f) => f.key)).toEqual(["object"]);
    // Both directions of the budget contract: what the connector can claim
    // against is exactly what the entry declares a limit for.
    expect(Object.keys(e.rateLimits ?? {}).sort()).toEqual(["objects.list", "records.query"]);
    expect([...(attioConnector.operations ?? [])].sort()).toEqual(["objects.list", "records.query"]);
    expect(attioConnector.listOperationFor?.("object")).toBe("objects.list");
  });
});

describe("attio: signature", () => {
  it("hex HMAC-SHA256 over the raw body, under either header name; fails closed", () => {
    // Attio's scheme signs the body alone — there is no timestamp in it, so
    // there is no staleness window to test.
    const body = JSON.stringify({ webhook_id: "wh", events: [{ event_type: "record.created", id: { object_id: "obj_deals", record_id: "rec_1" } }] });
    expect(attioConnector.verifySignature({ rawBody: body, headers: { "attio-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(attioConnector.verifySignature({ rawBody: body, headers: { "x-attio-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(attioConnector.verifySignature({ rawBody: body, headers: { "attio-signature": sign(body) }, secret: "other" })).toBe(false);
    expect(attioConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    expect(attioConnector.verifySignature({ rawBody: `${body} `, headers: { "attio-signature": sign(body) }, secret: SECRET })).toBe(false);
    expect(attioConnector.verifySignature({ rawBody: body, headers: { "attio-signature": sign(body) }, secret: null })).toBe(false);
  });
});

describe("attio: normalize (deliberately absent) and the record mapping the poll uses instead", () => {
  it("declares no normalize: the delivery carries ids and an actor, and nothing datable", () => {
    // https://api.attio.com/openapi/webhooks — an event is
    // { event_type, id: { …uuids }, actor }: no timestamp, no attribute values,
    // and the object as a bare UUID. Anything stored from it would be undated
    // and unclassifiable, so the hook is a doorbell and the poll does the
    // reading. Sabotage: add a normalize and this says so.
    expect(attioConnector.normalize).toBeUndefined();
    expect(ATTIO_SUBSCRIPTIONS).toEqual(["record.created"]);
  });

  it("a deal is opportunity_created at created_at in major units, plus the stage it entered at active_from", () => {
    const evs = attioRecordEvents("deals", deal(), CONN);
    expect(evs.map((e) => e.eventType)).toEqual(["opportunity_created", "deal_stage_changed"]);
    expect(evs[0]).toMatchObject({ eventId: "attio:conn_1:deals:rec_1", subject: "Acme expansion", value: 1200, currency: "USD" });
    expect(evs[0].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    // Dated by when the stage BEGAN, not by when this read happened.
    expect(evs[1]).toMatchObject({ eventId: "attio:conn_1:deals:rec_1:stage:in_progress", subject: "Acme expansion", value: 1200, currency: "USD" });
    expect(evs[1].occurredAt.toISOString()).toBe("2026-09-02T09:00:00.000Z");
    expect(evs[1].properties).toMatchObject({ stage: "In Progress" });
  });

  it("a person is lead_created keyed on the email; a deal with no stage yields one event", () => {
    const [ev] = attioRecordEvents("people", person(), CONN);
    expect(ev).toMatchObject({ eventId: "attio:conn_1:people:rec_p", eventType: "lead_created", subject: "ada@x.io", value: null, currency: null });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T08:00:00.000Z");
    const bare = attioRecordEvents("deals", deal({ values: { name: [{ value: "Acme expansion" }] } }), CONN);
    expect(bare.map((e) => e.eventType)).toEqual(["opportunity_created"]);
    expect(bare[0].value).toBeNull();
  });

  it("a custom object is record_created rather than a business word it has not earned", () => {
    const [ev] = attioRecordEvents("projects", { id: { record_id: "rec_x" }, created_at: "2026-09-03T00:00:00.000000000Z", values: {} }, CONN);
    expect(ev).toMatchObject({ eventId: "attio:conn_1:projects:rec_x", eventType: "record_created", subject: null });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    // A record with no parsable created_at has nothing to date and is skipped.
    expect(attioRecordEvents("projects", { id: { record_id: "rec_y" } }, CONN)).toEqual([]);
  });
});

describe("attio: poll (stream = one object)", () => {
  it("queries the object bounded on created_at, sorted ascending, and settles on the newest created_at", async () => {
    const calls = stubFetch([{ data: [deal()] }]);
    const res = await attioConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "tok" }, config: { object: "deals" }, streamHash: "h1" });
    expect(res.records.map((r) => r.eventType)).toEqual(["opportunity_created", "deal_stage_changed"]);
    // The watermark is the field the request bounds: created_at, not the
    // stage's later active_from.
    expect(res.nextCursor).toBe("2026-09-01T10:00:00.000Z");
    expect(new URL(calls[0].url).pathname).toBe("/v2/objects/deals/records/query");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ sorts: [{ direction: "asc", attribute: "created_at" }], limit: 500, offset: 0 });
    expect(String(body.filter.created_at.$gte)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("follows the offset until a short page and keeps every record in the burst", async () => {
    const full = Array.from({ length: 500 }, (_, i) =>
      person({ id: { record_id: `rec_${i}` }, created_at: `2026-09-01T${String(i % 24).padStart(2, "0")}:00:00.000000000Z` }),
    );
    const last = person({ id: { record_id: "rec_last" }, created_at: "2026-09-04T12:00:00.000000000Z" });
    const calls = stubFetch([{ data: full }, { data: [last] }]);
    const res = await attioConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "tok" }, config: { object: "people" } });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1].init.body)).offset).toBe(500);
    expect(res.records).toHaveLength(501);
    expect(res.records.every((r) => r.eventType === "lead_created")).toBe(true);
    expect(res.nextCursor).toBe("2026-09-04T12:00:00.000Z");
    expect(res.incomplete).toBeUndefined();
  });

  it("without an object there is nothing to read; listOptions names the workspace's objects", async () => {
    expect(await attioConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "tok" }, config: {} })).toEqual({ records: [], nextCursor: null });
    const calls = stubFetch([
      { data: [{ id: { object_id: "obj_deals" }, api_slug: "deals", singular_noun: "Deal", plural_noun: "Deals" }, { id: {}, api_slug: null, plural_noun: null }] },
    ]);
    expect(await attioConnector.listOptions!("object", { connectionId: CONN, credentials: { apiKey: "tok" } })).toEqual([{ value: "deals", label: "Deals" }]);
    expect(new URL(calls[0].url).pathname).toBe("/v2/objects");
  });

  it("registers Attio's own webhook and keeps the secret it mints; a 404 teardown is success", async () => {
    const calls = stubFetch([{ data: { id: { workspace_id: "ws", webhook_id: "wh_9" }, secret: "s9", status: "active" } }]);
    const reg = await attioConnector.registerWebhook!({ connectionId: CONN, webhookUrl: "https://app/api/webhooks/conn_1", credentials: { apiKey: "tok" } });
    expect(reg).toEqual({ signingSecret: "s9", externalId: "wh_9" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      data: { target_url: "https://app/api/webhooks/conn_1", subscriptions: [{ event_type: "record.created", filter: null }] },
    });
    const gone = stubStatus(404);
    await expect(attioConnector.unregisterWebhook!({ connectionId: CONN, credentials: { apiKey: "tok" }, externalId: "wh_9" })).resolves.toBeUndefined();
    expect(gone[0].init.method).toBe("DELETE");
    expect(new URL(gone[0].url).pathname).toBe("/v2/webhooks/wh_9");
  });
});
