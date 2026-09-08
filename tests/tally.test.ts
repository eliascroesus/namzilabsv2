import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { tallyConnector } from "@/connectors/tally";
import { catalogEntry, isStreamScoped } from "@/connectors/catalog";
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

const SECRET = "tally_secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64");
const delivery = {
  eventId: "ev1",
  eventType: "FORM_RESPONSE",
  createdAt: "2026-09-01T10:00:00.000Z",
  data: {
    responseId: "s1",
    submissionId: "s1",
    respondentId: "resp1",
    formId: "F1",
    formName: "Lead",
    createdAt: "2026-09-01T10:00:00.000Z",
    fields: [
      { key: "q_email", label: "Email", type: "INPUT_EMAIL", value: "lead@x.io" },
      { key: "q_name", label: "Name", type: "INPUT_TEXT", value: "Lee" },
    ],
  },
};
const submission = (over: Record<string, unknown> = {}) => ({ id: "s1", formId: "F1", isCompleted: true, submittedAt: "2026-09-01T10:00:00.000Z", respondentId: "resp1", responses: [{ questionId: "q_email", answer: "lead@x.io" }], ...over });

describe("tally: registration", () => {
  it("is in the catalog and the registry with dated provenance, stream-scoped on the form", () => {
    expect(getConnector("tally")).toBe(tallyConnector);
    const e = catalogEntry("tally")!;
    expect(e.docs?.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e.verified).toEqual({ live: null });
    expect(e.flowFields?.map((f) => f.key)).toEqual(["formId"]);
  });
});

/**
 * WHY TALLY ASKS FOR A SIGNING SECRET AND THE AUTO-WEBHOOK CONNECTORS DO NOT.
 *
 * Not an oversight to be tidied away later: POST /webhooks has
 * `"required": ["formId", "url", "eventTypes"]`, and Tally publishes no
 * account- or workspace-wide subscription. `formId` lives on a flow's Get
 * data step, so at connect time — the ONLY moment `registerWebhook` is ever
 * called (`createConnection`) — the one required argument does not exist.
 * These assertions pin the two halves of that argument together, so a future
 * "why is autoWebhook false here?" has its answer in the failing sabotage
 * rather than in someone's memory.
 */
describe("tally: no connect-time auto-registration, and the reason", () => {
  it("is stream-scoped on formId — the create call's required argument is chosen per step, not per connection", () => {
    expect(isStreamScoped("tally")).toBe(true);
    const [form] = catalogEntry("tally")!.flowFields!;
    // A readFilter would make it a WHERE clause over stored rows and the
    // source connection-scoped; formId narrows the REQUEST, so each form is
    // its own stream — and its own Tally webhook, if there ever is one.
    expect(form.key).toBe("formId");
    expect(form.readFilter).toBeUndefined();
    expect(form.required).toBe(true);
  });

  it("declares no auto-webhook and implements neither half of the hook", () => {
    expect(catalogEntry("tally")!.autoWebhook).toBe(false);
    expect(tallyConnector.registerWebhook).toBeUndefined();
    expect(tallyConnector.unregisterWebhook).toBeUndefined();
    // instant + !autoWebhook ⇒ the secret is pasted (or minted for pasting),
    // so the field it lands in and the sentence pointing at Tally's UI both
    // have to exist. Drop the field and C21 has nowhere to put the value.
    const e = catalogEntry("tally")!;
    expect(e.instant).toBe(true);
    expect(e.credentialFields.map((f) => f.key)).toEqual(["apiKey", "webhookSecret"]);
    expect(e.webhookSetup).toContain("Integrations");
  });

  it("the secret is OPTIONAL in behaviour: the poll alone yields completed AND partial, with no webhookSecret in credentials", async () => {
    const calls = stubFetch([
      { page: 1, hasMore: false, submissions: [submission(), submission({ id: "s2", isCompleted: false, submittedAt: "2026-09-01T11:00:00.000Z" })], questions: [] },
    ]);
    const res = await tallyConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" }, config: { formId: "F1" } });
    expect(res.records.map((r) => r.eventType)).toEqual(["form_submitted", "form_partial"]);
    // `filter: "all"` is what makes the webhook a doorbell rather than the
    // only door — flip it to "completed" and partials would need one.
    expect(new URL(calls[0].url).searchParams.get("filter")).toBe("all");
  });

  it("verifySignature fails closed on exactly one line", () => {
    const src = readFileSync("src/connectors/tally.ts", "utf8");
    expect(src.match(/if \(!secret\) return false;/g)).toHaveLength(1);
    expect(tallyConnector.verifySignature({ rawBody: "{}", headers: {}, secret: null })).toBe(false);
  });
});

describe("tally: signature", () => {
  it("base64 HMAC over the JSON body in tally-signature — raw or re-serialised compact; fails closed", () => {
    const body = JSON.stringify(delivery);
    expect(tallyConnector.verifySignature({ rawBody: body, headers: { "tally-signature": sign(body) }, secret: SECRET })).toBe(true);
    const pretty = JSON.stringify(delivery, null, 2);
    expect(tallyConnector.verifySignature({ rawBody: pretty, headers: { "tally-signature": sign(body) }, secret: SECRET })).toBe(true);
    expect(tallyConnector.verifySignature({ rawBody: body, headers: { "tally-signature": sign(body) }, secret: null })).toBe(false);
    expect(tallyConnector.verifySignature({ rawBody: body, headers: { "tally-signature": sign("x") }, secret: SECRET })).toBe(false);
    expect(tallyConnector.verifySignature({ rawBody: "{not json", headers: { "tally-signature": sign("x") }, secret: SECRET })).toBe(false);
  });
});

describe("tally: normalize", () => {
  it("FORM_RESPONSE is form_submitted at data.createdAt, keyed by submission id, subject from the email field", () => {
    const [ev] = tallyConnector.normalize!(delivery, { connectionId: CONN });
    expect(ev).toMatchObject({ eventId: "tally:conn_1:F1:s1", eventType: "form_submitted", subject: "lead@x.io" });
    expect(ev.occurredAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(ev.properties).toMatchObject({ fields_by_label: { Email: "lead@x.io", Name: "Lee" }, formName: "Lead" });
    expect(tallyConnector.normalize!({ ...delivery, eventType: "SOMETHING_ELSE" }, { connectionId: CONN })).toEqual([]);
  });
});

describe("tally: poll (stream = one form)", () => {
  it("pages submissions from startDate, labels partials, and settles on the newest submittedAt", async () => {
    const calls = stubFetch([
      { page: 1, limit: 500, hasMore: false, submissions: [submission(), submission({ id: "s2", isCompleted: false, submittedAt: "2026-09-01T11:00:00.000Z" })], questions: [{ id: "q_email", title: "Email", type: "INPUT_EMAIL" }] },
    ]);
    const res = await tallyConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" }, config: { formId: "F1" } });
    expect(res.records.map((r) => `${r.eventType}:${r.eventId}`)).toEqual(["form_submitted:tally:conn_1:F1:s1", "form_partial:tally:conn_1:F1:s2"]);
    expect(res.records[0].properties).toMatchObject({ fields_by_label: { Email: "lead@x.io" } });
    expect(res.records[0].subject).toBe("lead@x.io");
    expect(res.nextCursor).toBe("2026-09-01T11:00:00.000Z");
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/forms/F1/submissions");
    expect(u.searchParams.get("filter")).toBe("all");
    expect(u.searchParams.get("limit")).toBe("500");
    expect(u.searchParams.get("startDate")).toMatch(/^\d{4}-/);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });
  it("follows hasMore by page; listOptions names the forms", async () => {
    const calls = stubFetch([{ page: 1, hasMore: true, submissions: [submission()], questions: [] }, { page: 2, hasMore: false, submissions: [], questions: [] }]);
    await tallyConnector.poll!({ connectionId: CONN, cursor: null, credentials: { apiKey: "k" }, config: { formId: "F1" } });
    expect(new URL(calls[1].url).searchParams.get("page")).toBe("2");
    stubFetch([{ items: [{ id: "F1", name: "Lead" }], hasMore: false }]);
    expect(await tallyConnector.listOptions!("formId", { connectionId: CONN, credentials: { apiKey: "k" } })).toEqual([{ value: "F1", label: "Lead" }]);
  });
});
