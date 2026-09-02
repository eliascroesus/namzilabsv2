import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt } from "@/lib/crypto";
import { getConnectionCredentials } from "@/lib/credentials";
import { HttpError } from "@/lib/http-client";
import type { DB } from "@/db/types";

/**
 * C12 — a revoked Google grant must say what to do, not read as an opaque
 * "provider failed" forever.
 *
 * `getConnectionCredentials` refreshes an expiring Google token through
 * `refreshGoogleToken` -> `fetchJson`, which throws a typed `HttpError` on any
 * non-2xx response (http-client.test.ts). Google's token endpoint answers a
 * revoked or expired refresh token with 400 `invalid_grant` — a permanent
 * state no retry will ever fix — so that one case is reworded into something
 * actionable before it lands in `connections.lastError`. Everything else (a
 * timeout, a 503) is transient/already typed for the breaker
 * (`recordProviderError`/`tripBreaker`, reconcile.ts) and must reach it
 * unchanged.
 */

const KEY = randomBytes(32).toString("base64");
// refreshGoogleToken always throws in these tests, before getConnectionCredentials
// ever touches `db` — so a real database is unnecessary ceremony here (same cast
// used in tests/helpers/testdb.ts and src/lib/sync/locks.ts).
const fakeDb = {} as unknown as DB;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY;
  // refreshGoogleToken's own reqEnv() guard throws before ever reaching fetch
  // if these are missing — set once, same as any other deployment would have.
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function googleTokenResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function googleConn(source = "gsheets") {
  const creds = { accessToken: "stale-access-token", refreshToken: "refresh-1", expiresAt: Date.now() - 1_000 };
  return {
    id: "conn-1",
    source,
    credentialsEncrypted: encrypt(JSON.stringify(creds), Buffer.from(KEY, "base64")),
  };
}

describe("a revoked or expired Google grant", () => {
  it("reads as an actionable message instead of a raw HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        googleTokenResponse(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
      ),
    );

    await expect(getConnectionCredentials(fakeDb, googleConn())).rejects.toThrow(
      "Google access has expired or been revoked. Reconnect this Google account from Integrations.",
    );
  });

  it("rethrows any other refresh failure unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => googleTokenResponse(503, { error: "backend_error" })));

    const err: unknown = await getConnectionCredentials(fakeDb, googleConn()).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError); // untouched — not reworded, not swallowed
    expect((err as HttpError).status).toBe(503);
  });
});
