import { describe, it, expect, vi, afterEach } from "vitest";
import { sourceConnectable } from "@/lib/oauth/providers";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";

afterEach(() => vi.unstubAllEnvs());

/**
 * A CONNECTOR EXISTS IN THE CATALOGUE THE MOMENT ITS CODE DOES, and the
 * provider app registration behind it can be weeks away — Google Ads needs a
 * developer token and an OAuth verification from two different queues at
 * Google, neither of which any amount of code can hurry.
 *
 * The failure this prevents is specific and would have shipped: an OAuth source
 * with no client id does not degrade, it THROWS. `buildAuthUrl` calls `reqEnv`,
 * the start route 500s, and the customer's click on a card we put in front of
 * them lands on an error page. A card that explains itself is strictly better
 * than a button that does that.
 */
describe("a source is only offered when it can actually be connected", () => {
  it("refuses an OAuth source whose client credentials are absent", () => {
    vi.stubEnv("META_APP_ID", "");
    vi.stubEnv("META_APP_SECRET", "");
    expect(sourceConnectable("meta-ads")).toBe(false);
  });

  it("allows it once both halves are present", () => {
    vi.stubEnv("META_APP_ID", "app");
    vi.stubEnv("META_APP_SECRET", "secret");
    expect(sourceConnectable("meta-ads")).toBe(true);
  });

  it("refuses when only one half is configured", () => {
    // Half a credential is not a credential, and the failure it produces is the
    // same 500 as none at all.
    vi.stubEnv("META_APP_ID", "app");
    vi.stubEnv("META_APP_SECRET", "");
    expect(sourceConnectable("meta-ads")).toBe(false);
  });

  it("refuses Google Ads without its developer token, even though Google OAuth is configured", () => {
    /**
     * THE CASE THE PROVIDER CHECK ALONE CANNOT SEE. Google Ads rides the
     * existing GOOGLE_CLIENT_ID that Sheets and Calendar already use, so its
     * provider looks perfectly configured — while every request it makes is
     * refused by Google without a developer token.
     */
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "");
    expect(sourceConnectable("gads")).toBe(false);

    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "dev");
    expect(sourceConnectable("gads")).toBe(true);
  });

  it("refuses TikTok without the app credentials its picker needs at runtime", () => {
    vi.stubEnv("TIKTOK_APP_ID", "id");
    vi.stubEnv("TIKTOK_APP_SECRET", "");
    expect(sourceConnectable("tiktok-ads")).toBe(false);
  });

  it("does not gate the sources you paste a key into", () => {
    // Their credential is the customer's, so there is nothing of ours to be
    // missing — gating them would empty the catalogue on a fresh deploy.
    for (const entry of CONNECTOR_CATALOG.filter((e) => e.connect === "apiKey")) {
      expect(sourceConnectable(entry.source), entry.source).toBe(true);
    }
  });

  it("keeps the existing Google connectors working on the credentials they already use", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret");
    for (const source of ["gsheets", "gcal", "ganalytics"]) {
      expect(sourceConnectable(source), source).toBe(true);
    }
  });

  it("answers false for a source that does not exist", () => {
    expect(sourceConnectable("nope")).toBe(false);
  });
});
