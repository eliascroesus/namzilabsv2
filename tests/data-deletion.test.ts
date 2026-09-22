import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE DELETION PAGE, AND THE ONE PROPERTY IT CANNOT LOSE.
 *
 * Meta, TikTok and Google all require a reachable data-deletion route before an
 * app passes review, and the person opening it is a reviewer with NO ACCOUNT
 * HERE. So "does it render" is the lesser half: the half that fails a review is
 * the page quietly ending up behind the cookie wall, where it answers a
 * redirect to sign-in and reads as though it does not exist.
 *
 * `src/proxy.ts` keeps it public by OMISSION — it is simply not in
 * `PROTECTED_PAGE_PREFIXES` — and omission is exactly the kind of fact that
 * changes by accident when somebody adds a prefix. Hence a test that reads the
 * list rather than trusting it.
 */

vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => createElement("a", { href: props.href, className: props.className }, props.children),
}));

import DataDeletionPage from "@/app/data-deletion/page";
import PrivacyPage from "@/app/privacy/page";

const root = join(__dirname, "..");
const plain = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ");

describe("the data deletion page is reachable without an account", () => {
  const proxy = readFileSync(join(root, "src/proxy.ts"), "utf8");

  it("is not behind the cookie wall", () => {
    /**
     * Sabotage: add "/data-deletion" to PROTECTED_PAGE_PREFIXES and this fails.
     * That is the change that would pass every other test in the suite, ship,
     * and then fail an app review weeks later with no error anywhere.
     */
    const list = /const PROTECTED_PAGE_PREFIXES = \[([^\]]*)\]/.exec(proxy)?.[1] ?? "";
    expect(list, "the deletion page must stay anonymous-readable").not.toContain("data-deletion");
  });

  it("sits alongside the other public legal pages, not among the protected ones", () => {
    // The protected list is page prefixes only; /privacy and /terms are absent
    // for the same reason this is. If they ever appear, this assumption moved.
    const list = /const PROTECTED_PAGE_PREFIXES = \[([^\]]*)\]/.exec(proxy)?.[1] ?? "";
    expect(list).not.toContain("privacy");
    expect(list).not.toContain("terms");
  });
});

describe("the page tells people how to actually delete things", () => {
  const html = renderToStaticMarkup(createElement(DataDeletionPage));
  const text = plain(html);

  it("names both self-serve routes, in the words the app uses", () => {
    // These strings are the BUTTONS. A guide that says "remove the integration"
    // when the control says "Delete permanently" sends the reader hunting.
    expect(text).toContain("Delete permanently");
    expect(text).toContain("Delete everything");
    expect(text).toContain("Delete this workspace");
    expect(text).toContain("Delete forever");
  });

  it("says deletion is immediate and irreversible, because it is", () => {
    // `destroyWorkspaceData` is a hard delete with no grace period. A page
    // implying a bin to recover from would be the one lie that costs data.
    expect(text.toLowerCase()).toMatch(/immediately|immediate/);
    expect(text.toLowerCase()).toMatch(/cannot be undone|permanently/);
  });

  it("distinguishes disconnecting from deleting", () => {
    // The commonest way to think you deleted something here and not have.
    expect(text).toContain("Disconnect");
    expect(text.toLowerCase()).toContain("it is not a deletion");
  });

  it("is honest that withdrawing provider access is not a deletion", () => {
    expect(text.toLowerCase()).toContain("does not delete what we already hold");
  });

  it("declares the one thing that survives", () => {
    /**
     * `audit_log` is deliberately exempted in destroy.ts, and tests/audit.test.ts
     * enforces that it holds no personal data or user content. Saying so is a
     * promise the suite keeps; omitting it would make the rest of the page a
     * slightly-untrue claim that everything goes.
     */
    expect(text.toLowerCase()).toContain("audit");
    expect(text.toLowerCase()).toContain("no personal data");
  });

  it("gives a route for somebody locked out, with a timeframe", () => {
    expect(text).toContain("support@namzilabs.com");
    expect(text).toMatch(/30 days/);
  });

  it("carries a contact address that is actually an address", () => {
    expect(html).toContain('href="mailto:support@namzilabs.com"');
  });
});

describe("the privacy policy points at it", () => {
  /**
   * A deletion page nothing links to is one a reviewer has to be handed the URL
   * for, and one a customer never finds. The policy is where they look.
   */
  const html = renderToStaticMarkup(createElement(PrivacyPage));

  it("links to the deletion page rather than only offering an email", () => {
    expect(html).toContain('href="/data-deletion"');
  });
});
