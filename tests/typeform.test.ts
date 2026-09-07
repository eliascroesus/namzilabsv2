import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { typeformConnector } from "@/connectors/typeform";
import { catalogEntry } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";

afterEach(() => vi.unstubAllGlobals());
const CONN = "conn_1";

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

const SECRET = "tf_secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("base64")}`;
const response = (over: Record<string, unknown> = {}) => ({
  response_id: "r1",
  token: "tok1",
  landed_at: "2026-09-01T10:00:00Z",
  submitted_at: "2026-09-01T10:03:00Z",
  answers: [
    { type: "email", email: "lead@x.io", field: { id: "f1", type: "email" } },
    { type: "text", text: "hi", field: { id: "f2", ref: "message", type: "short_text" } },
    { type: "choice", choice: { label: "Agency" }, field: { id: "f3", type: "multiple_choice" } },
  ],
  hidden: { utm: "x" },
  ...over,
});

describe("typeform: registration", () => {
  it("is in the catalog and the registry with dated provenance, stream-scoped on the form", () => {
    expect(getConnector("typeform")).toBe(typeformConnector);
    const e = catalogEntry("typeform")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.flowFields?.map((f) => f.key)).toEqual(["formId"]);
  });
});

describe("typeform: signature", () => {
  it("base64 HMAC over the raw body behind sha256=; fails closed", () => {
    const body = JSON.stringify({ event_id: "e1", event_type: "form_response", form_response: response() });
    expect(typeformConnector.verifySignature({ rawBody: body, headers: { "typeform-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(typeformConnector.verifySignature({ rawBody: body, headers: { "typeform-signature": sign(body) }, secret: null })).toBe(false);
    expect(typeformConnector.verifySignature({ rawBody: body, headers: {}, secret: SECRET })).toBe(false);
    expect(typeformConnector.verifySignature({ rawBody: body + " ", headers: { "typeform-signature": sign(body) }, secret: SECRET })).toBe(false);
  });
});

describe("typeform: normalize", () => {
  it("a submission is form_submitted at submitted_at with the email answer as subject, plus form_started at landed_at", () => {
    const evs = typeformConnector.normalize!({ event_id: "e1", event_type: "form_response", form_response: { form_id: "F1", ...response() } }, { connectionId: CONN });
    expect(evs.map((e) => e.eventType)).toEqual(["form_submitted", "form_started"]);
    expect(evs[0]).toMatchObject({ eventId: "typeform:conn_1:F1:tok1", subject: "lead@x.io" });
    expect(evs[0].occurredAt.toISOString()).toBe("2026-09-01T10:03:00.000Z");
    expect(evs[1]).toMatchObject({ eventId: "typeform:conn_1:F1:tok1:started" });
    expect(evs[1].occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(evs[0].properties).toMatchObject({ answers_by_field: { f1: "lead@x.io", message: "hi", f3: "Agency" }, hidden: { utm: "x" } });
  });
  it("the year-1 sentinel means not submitted: only form_started is emitted", () => {
    const evs = typeformConnector.normalize!({ event_id: "e2", event_type: "form_response", form_response: { form_id: "F1", ...response({ submitted_at: "0001-01-01T00:00:00Z" }) } }, { connectionId: CONN });
    expect(evs.map((e) => e.eventType)).toEqual(["form_started"]);
  });
});

describe("typeform: poll (stream = one form)", () => {
  it("lists a form's responses since the mark, sorted ascending, follows `after`, settles on the newest submitted_at", async () => {
    const calls = stubFetch([{ total_items: 1, page_count: 1, items: [response()] }]);
    const res = await typeformConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pat" }, config: { formId: "F1" }, streamHash: "h1" });
    expect(res.records.map((r) => r.eventType)).toEqual(["form_submitted", "form_started"]);
    expect(res.nextCursor).toBe("2026-09-01T10:03:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/forms/F1/responses");
    expect(u.searchParams.get("sort")).toBe("submitted_at,asc");
    expect(u.searchParams.get("page_size")).toBe("1000");
    expect(u.searchParams.get("since")).toMatch(/^\d{4}-/);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer pat");
  });
  it("without a form there is nothing to read; listOptions names the forms", async () => {
    expect(await typeformConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "pat" }, config: {} })).toEqual({ records: [], nextCursor: null });
    const calls = stubFetch([{ items: [{ id: "F1", title: "Intro call" }] }]);
    expect(await typeformConnector.listOptions!("formId", { connectionId: CONN, credentials: { apiKey: "pat" } })).toEqual([{ value: "F1", label: "Intro call" }]);
    expect(new URL(calls[0].url).searchParams.get("page_size")).toBe("200");
  });
});
