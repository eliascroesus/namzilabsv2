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
    const [ev] = catchHookConnector.normalize(
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
    const [a] = catchHookConnector.normalize({ foo: "bar" }, ctx);
    const [b] = catchHookConnector.normalize({ foo: "bar" }, ctx);
    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId.startsWith("webhook:conn-123:")).toBe(true);
  });

  it("expands an array payload into multiple events", () => {
    const evs = catchHookConnector.normalize([{ id: "1" }, { id: "2" }], ctx);
    expect(evs.map((e) => e.eventId)).toEqual(["webhook:conn-123:1", "webhook:conn-123:2"]);
  });

  it("defaults event type and timestamp when absent", () => {
    const [ev] = catchHookConnector.normalize({ id: "1" }, ctx);
    expect(ev.eventType).toBe("webhook.received");
    expect(ev.occurredAt).toBeInstanceOf(Date);
  });
});
