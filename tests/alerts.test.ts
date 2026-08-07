import { describe, it, expect, afterEach, vi } from "vitest";
import { sendOpsAlert } from "@/lib/alerts";

/**
 * The ops alert's three contracts: it actually sends (right endpoint, right
 * auth, right payload), it NEVER throws (an alert about a scan must not be
 * able to fail the scan), and it never fires without configuration (dev/CI
 * silence).
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const stubEnv = () => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("ALERT_EMAIL", "ops@example.com");
  vi.stubEnv("ALERT_FROM", "alerts@namzilabs.com");
};

describe("sendOpsAlert", () => {
  it("POSTs the alert to Resend with bearer auth and the configured addresses", async () => {
    stubEnv();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init! });
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }),
    );

    const res = await sendOpsAlert("[namzilabs] test subject", "body text");

    expect(res).toEqual({ sent: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, string>;
    expect(body.to).toBe("ops@example.com");
    expect(body.from).toBe("alerts@namzilabs.com");
    expect(body.subject).toBe("[namzilabs] test subject");
    expect(body.text).toBe("body text");
  });

  it("RESOLVES {sent:false} when the network fails — never throws", async () => {
    stubEnv();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("dns down"))));
    // Sabotage pin: let the fetch error propagate and this rejects — which
    // would let a mail hiccup fail the nightly scan that called it.
    await expect(sendOpsAlert("s", "b")).resolves.toEqual({ sent: false });
  });

  it("resolves {sent:false} on a non-2xx response", async () => {
    stubEnv();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid api key", { status: 401 })));
    await expect(sendOpsAlert("s", "b")).resolves.toEqual({ sent: false });
  });

  it("never calls fetch when env is not configured (dev/CI silence)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await expect(sendOpsAlert("s", "b")).resolves.toEqual({ sent: false });
    expect(spy).not.toHaveBeenCalled();
  });
});
