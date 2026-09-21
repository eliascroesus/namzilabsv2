import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE CARD AN OAUTH SOURCE IS CONNECTED FROM.
 *
 * Two things about it were wrong the moment a non-Google OAuth source existed,
 * and neither is visible in a data test:
 *
 *   1. THE BUTTON SAID "Connect with Google" FOR EVERY OAUTH SOURCE. That was
 *      true of all three Google connectors and became a lie on the first Meta
 *      card — a button offering to connect one company's account while sending
 *      the customer to another's.
 *   2. AN OAUTH CARD HAS NO DIALOG, so it had nowhere to link its setup guide.
 *      The credential sources reach theirs from inside the connect dialog; for
 *      Meta, TikTok and Google Ads — where the guide answers "why does my ad
 *      account not appear" — the page was reachable only by typing the URL.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => createElement("a", { href: props.href, className: props.className }, props.children),
}));
vi.mock("@/app/integrations/actions", () => ({
  renameConnectionAction: async () => ({ ok: true }),
  disconnectAction: async () => {},
  reconnectAction: async () => {},
  deleteConnectionAction: async () => {},
}));

import { AppDirectory, type DirectoryApp } from "@/app/integrations/ConnectionRow";

const app = (over: Partial<DirectoryApp>): DirectoryApp => ({
  source: "meta-ads",
  name: "Meta Ads",
  description: "Spend and conversions.",
  instant: false,
  poll: true,
  connectedCount: 0,
  ...over,
});

function render(apps: DirectoryApp[]): string {
  return renderToStaticMarkup(
    createElement(AppDirectory, { apps, connected: [], connectionsUnavailable: false, tally: "" }),
  );
}

describe("an OAuth card names the provider it actually sends you to", () => {
  it("says Connect with Meta, not Connect with Google", () => {
    const html = render([app({ oauthHref: "/api/oauth/meta/start?source=meta-ads", oauthLabel: "Connect with Meta" })]);
    expect(html).toContain("Connect with Meta");
    expect(html, "the hard-coded Google label is back").not.toContain("Connect with Google");
  });

  it("says Connect with TikTok for TikTok", () => {
    const html = render([
      app({ source: "tiktok-ads", name: "TikTok Ads", oauthHref: "/api/oauth/tiktok/start?source=tiktok-ads", oauthLabel: "Connect with TikTok" }),
    ]);
    expect(html).toContain("Connect with TikTok");
  });

  it("still says Connect with Google for a Google source", () => {
    const html = render([app({ source: "gads", name: "Google Ads", oauthHref: "/api/oauth/google/start?source=gads", oauthLabel: "Connect with Google" })]);
    expect(html).toContain("Connect with Google");
  });

  it("falls back to the app's own name rather than to another company's", () => {
    // If the label is ever dropped, the wrong answer must not be "Google".
    const html = render([app({ oauthHref: "/api/oauth/meta/start?source=meta-ads" })]);
    expect(html).toContain("Connect Meta Ads");
    expect(html).not.toContain("Connect with Google");
  });
});

describe("an OAuth card can reach its own setup guide", () => {
  it("links to the guide, because there is no dialog to hold the link", () => {
    const html = render([
      app({ oauthHref: "/api/oauth/meta/start?source=meta-ads", oauthLabel: "Connect with Meta", guideHref: "/docs/meta-ads" }),
    ]);
    expect(html).toContain('href="/docs/meta-ads"');
    expect(html).toContain("Before you connect");
  });

  it("links nowhere when the source has no guide page", () => {
    // `/docs/[source]` sets `dynamicParams = false`, so a link to an unguided
    // source is a 404 rather than an empty page.
    const html = render([app({ oauthHref: "/api/oauth/meta/start?source=meta-ads", oauthLabel: "Connect with Meta" })]);
    expect(html).not.toContain("/docs/");
  });

  it("leaves a credential source's card alone — its link lives in the dialog", () => {
    const html = render([app({ source: "stripe", name: "Stripe", guideHref: "/docs/stripe" })]);
    expect(html).not.toContain('href="/docs/stripe"');
  });
});
