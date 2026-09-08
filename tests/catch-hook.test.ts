import { describe, it, expect } from "vitest";
import { catchHookConnector, CATCH_HOOK_SIGNATURE_HEADER } from "@/connectors/catch-hook";
import { hmacSha256Hex } from "@/lib/signatures";

const ctx = { connectionId: "conn-123" };

describe("catch-hook connector: signature verification", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "1", type: "booked" });

  it("accepts a valid HMAC signature", () => {
    const sig = hmacSha256Hex(secret, body);
    expect(
      catchHookConnector.verifySignature({ rawBody: body, headers: { [CATCH_HOOK_SIGNATURE_HEADER]: sig }, secret }),
    ).toBe(true);
  });

  it("accepts a 'sha256=' prefixed signature", () => {
    const sig = `sha256=${hmacSha256Hex(secret, body)}`;
    expect(
      catchHookConnector.verifySignature({ rawBody: body, headers: { [CATCH_HOOK_SIGNATURE_HEADER]: sig }, secret }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = hmacSha256Hex(secret, body);
    expect(
      catchHookConnector.verifySignature({
        rawBody: body + "x",
        headers: { [CATCH_HOOK_SIGNATURE_HEADER]: sig },
        secret,
      }),
    ).toBe(false);
  });

  it("rejects a missing signature when a secret is configured", () => {
    expect(catchHookConnector.verifySignature({ rawBody: body, headers: {}, secret })).toBe(false);
  });

  it("accepts anything when no secret is configured (open hook)", () => {
    expect(catchHookConnector.verifySignature({ rawBody: body, headers: {}, secret: null })).toBe(true);
  });
});

describe("catch-hook connector: normalization", () => {
  it("maps a natural id and common fields", () => {
    const [ev] = catchHookConnector.normalize!(
      { id: "abc", type: "booked", email: "a@b.com", occurred_at: "2026-01-01T00:00:00Z", value: 42 },
      ctx,
    );
    expect(ev.eventId).toBe("webhook:conn-123:abc");
    expect(ev.eventType).toBe("booked");
    expect(ev.subject).toBe("a@b.com");
    expect(ev.occurredAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(ev.value).toBe(42);
  });

  it("derives a stable hash id when no natural id exists", () => {
    const [a] = catchHookConnector.normalize!({ foo: "bar" }, ctx);
    const [b] = catchHookConnector.normalize!({ foo: "bar" }, ctx);
    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId.startsWith("webhook:conn-123:")).toBe(true);
  });

  it("expands an array payload into multiple events", () => {
    const evs = catchHookConnector.normalize!([{ id: "1" }, { id: "2" }], ctx);
    expect(evs.map((e) => e.eventId)).toEqual(["webhook:conn-123:1", "webhook:conn-123:2"]);
  });

  it("defaults event type and timestamp when absent", () => {
    const [ev] = catchHookConnector.normalize!({ id: "1" }, ctx);
    expect(ev.eventType).toBe("webhook.received");
    expect(ev.occurredAt).toBeInstanceOf(Date);
  });

  it("prefers the delivery id header (webhook-id/svix-id) over the payload hash", () => {
    const withDelivery = { ...ctx, headers: { "Webhook-Id": "msg_1" } };
    // Redelivery of the same message → same id, even if the sender injected noise.
    const [a] = catchHookConnector.normalize!({ foo: "bar", sent_at_ms: 1 }, withDelivery);
    const [b] = catchHookConnector.normalize!({ foo: "bar", sent_at_ms: 2 }, withDelivery);
    expect(a.eventId).toBe("webhook:conn-123:delivery:msg_1:0");
    expect(b.eventId).toBe(a.eventId);

    // Two DIFFERENT deliveries with equal payloads stay two events.
    const other = { ...ctx, headers: { "svix-id": "msg_2" } };
    const [c] = catchHookConnector.normalize!({ foo: "bar" }, other);
    expect(c.eventId).toBe("webhook:conn-123:delivery:msg_2:0");
    expect(c.eventId).not.toBe(a.eventId);

    // An array delivery keeps one event per item.
    const evs = catchHookConnector.normalize!([{ foo: 1 }, { foo: 2 }], withDelivery);
    expect(evs.map((e) => e.eventId)).toEqual([
      "webhook:conn-123:delivery:msg_1:0",
      "webhook:conn-123:delivery:msg_1:1",
    ]);

    // A payload natural id still wins over the delivery id.
    const [n] = catchHookConnector.normalize!({ id: "abc" }, withDelivery);
    expect(n.eventId).toBe("webhook:conn-123:abc");
  });
});

describe("catch-hook connector: the envelope everyone actually posts", () => {
  it("reads through a {type, data} wrapper — the shape Stripe made standard", () => {
    const [ev] = catchHookConnector.normalize!(
      { type: "order.created", data: { id: "ord_1", email: "a@b.io", amount: 42 } },
      ctx,
    );
    // Before: no subject, no value, and an id hashed from the whole envelope.
    expect(ev.eventId).toBe("webhook:conn-123:ord_1");
    expect(ev.eventType).toBe("order.created");
    expect(ev.subject).toBe("a@b.io");
    expect(ev.value).toBe(42);
  });

  it("splits a batch, because fifty sales in one delivery are fifty events", () => {
    const evs = catchHookConnector.normalize!(
      { type: "orders.synced", events: [{ id: "a", amount: 1 }, { id: "b", amount: 2 }] },
      ctx,
    );
    expect(evs).toHaveLength(2);
    expect(evs.map((e) => e.eventId)).toEqual(["webhook:conn-123:a", "webhook:conn-123:b"]);
    expect(evs.map((e) => e.value)).toEqual([1, 2]);
    // The envelope's label rides along on every item.
    expect(evs.map((e) => e.eventType)).toEqual(["orders.synced", "orders.synced"]);
  });

  it("the inner record wins a name collision with the envelope's label", () => {
    const [ev] = catchHookConnector.normalize!({ id: "delivery_1", data: { id: "ord_9" } }, ctx);
    expect(ev.eventId).toBe("webhook:conn-123:ord_9");
  });

  it("leaves a real record alone: two nested keys is data, not a wrapper", () => {
    // `customer` and `line_items` are both objects, so this is somebody's order,
    // not an envelope around one. Hoisting either would be a guess.
    const [ev] = catchHookConnector.normalize!(
      { id: "ord_2", email: "top@b.io", customer: { email: "inner@b.io" }, line_items: [{ sku: "x" }] },
      ctx,
    );
    expect(ev.subject).toBe("top@b.io");
    expect(ev.eventId).toBe("webhook:conn-123:ord_2");
  });

  it("leaves an unrecognised single wrapper alone rather than guessing", () => {
    const [ev] = catchHookConnector.normalize!({ order: { id: "ord_3", email: "a@b.io" } }, ctx);
    expect(ev.subject).toBeNull();
    expect(ev.eventId).not.toContain("ord_3");
  });

  it("keeps the delivery verbatim in properties, so nothing hoisting missed is lost", () => {
    const raw = { type: "t", data: { id: "1", weird_field: "keep me" } };
    const [ev] = catchHookConnector.normalize!(raw, ctx);
    expect(ev.properties).toMatchObject({ type: "t", weird_field: "keep me" });
  });

  it("dates a wrapped delivery from the ORIGINAL payload, so a data.* answer still resolves", () => {
    const withKey = { ...ctx, eventTime: { key: "data.created_at" } };
    const [ev] = catchHookConnector.normalize!(
      { type: "t", data: { id: "1", created_at: "2026-03-04T05:06:07Z" } },
      withKey,
    );
    expect(ev.occurredAt.toISOString()).toBe("2026-03-04T05:06:07.000Z");
  });

  it("dates each item of a split batch from the item itself", () => {
    const evs = catchHookConnector.normalize!(
      { events: [{ id: "a", occurred_at: "2026-01-01T00:00:00Z" }, { id: "b", occurred_at: "2026-02-02T00:00:00Z" }] },
      ctx,
    );
    expect(evs.map((e) => e.occurredAt.toISOString())).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-02-02T00:00:00.000Z",
    ]);
  });
});
