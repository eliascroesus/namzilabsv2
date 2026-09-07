import { describe, it, expect } from "vitest";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { getConnector } from "@/connectors/registry";
import { oauthProvider } from "@/lib/oauth/providers";

/** The seven that predate the kit; everything after them must carry provenance. */
const LEGACY = new Set(["calendly", "close", "instantly", "whop", "gsheets", "gcal", "webhook"]);
const unsigned = { rawBody: "{}", headers: {}, secret: null };

describe("every catalog entry and every registered connector agree", () => {
  it("the catalog and the registry name the same sources", () => {
    for (const e of CONNECTOR_CATALOG) expect(getConnector(e.source), `${e.source}: registered`).toBeDefined();
  });
  it("sources are unique, lowercase, and URL-safe", () => {
    const seen = new Set<string>();
    for (const e of CONNECTOR_CATALOG) {
      expect(e.source).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(seen.has(e.source), `${e.source} declared twice`).toBe(false);
      seen.add(e.source);
    }
  });
  it("authType agrees with how the user connects", () => {
    for (const e of CONNECTOR_CATALOG) {
      const c = getConnector(e.source)!;
      if (e.connect === "google" || e.connect === "oauth") expect(c.authType, e.source).toBe("oauth2");
      else expect(["apiKey", "secret"], e.source).toContain(c.authType);
      if (e.connect === "oauth") expect(oauthProvider(e.oauthProvider), `${e.source}: registered oauthProvider`).toBeDefined();
    }
  });
  it("capabilities the entry advertises exist on the connector", () => {
    for (const e of CONNECTOR_CATALOG) {
      const c = getConnector(e.source)!;
      if (e.poll) expect(typeof c.poll, `${e.source}: poll`).toBe("function");
      if (e.autoWebhook) expect(typeof c.registerWebhook, `${e.source}: registerWebhook`).toBe("function");
      if (e.flowFields?.some((f) => f.dynamic)) expect(typeof c.listOptions, `${e.source}: listOptions`).toBe("function");
      if (e.instant && e.source !== "webhook") {
        expect(c.verifySignature(unsigned), `${e.source} accepts an unsigned request`).toBe(false);
        expect(typeof c.normalize === "function" || e.poll, `${e.source}: instant needs normalize or a poll doorbell`).toBeTruthy();
      }
    }
  });
  it("every entry carries a brand, and every post-kit entry carries dated provenance", () => {
    for (const e of CONNECTOR_CATALOG) {
      expect(e.brand, `${e.source}: brand`).toBeDefined();
      if (LEGACY.has(e.source)) continue;
      expect(e.docs?.url, `${e.source}: docs.url`).toMatch(/^https:\/\//);
      expect(e.docs?.readOn, `${e.source}: docs.readOn`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.verified, `${e.source}: verified`).toBeDefined();
    }
  });
});
