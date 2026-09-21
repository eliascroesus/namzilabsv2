import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * WHAT THE SETUP PAGE ACTUALLY EMITS.
 *
 * `connector-guides.test.ts` asserts the catalog HOLDS oauth sections. That is
 * a different claim from the page SHOWING them, and the gap between the two is
 * exactly where this feature could have died silently: the guide type gained an
 * `oauth` block, every data assertion passed, and if the renderer had never been
 * taught to walk it the three ads pages would have rendered a heading, a footer,
 * and nothing in between — with a fully green suite.
 *
 * So this renders the real page component and looks for the words.
 *
 * `renderToStaticMarkup` on an async server component: awaiting it yields the
 * element tree, which renders without hydration, events or a DOM — and is also
 * a constraint the page must satisfy, since a docs page may not reach for
 * request state.
 */

vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => createElement("a", { href: props.href, className: props.className }, props.children),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

import ConnectorDocsPage from "@/app/docs/[source]/page";
import { catalogEntry } from "@/connectors/catalog";

async function render(source: string): Promise<string> {
  const el = await ConnectorDocsPage({ params: Promise.resolve({ source }) });
  return renderToStaticMarkup(el);
}

/** Markup carries HTML entities; compare on text the way a reader would see it. */
const plain = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("an OAuth connector's setup page shows its oauth sections", () => {
  for (const source of ["meta-ads", "tiktok-ads", "gads"]) {
    it(`${source}: every section title and every step reaches the page`, async () => {
      const entry = catalogEntry(source)!;
      const sections = entry.guide!.oauth!.sections;
      // Sabotage: delete the `guide.oauth?.sections.map(...)` line from the page
      // and this names the first step that stopped rendering.
      expect(sections.length).toBeGreaterThan(0);

      const text = plain(await render(source));
      for (const block of sections) {
        expect(text, `${source}: section title "${block.title}" is not on the page`).toContain(block.title);
        for (const step of block.steps) {
          // A step carrying a link renders as prose + anchor, so compare on the
          // link's LABEL rather than on its markdown source.
          const asRendered = plain(step.replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, "$1"));
          expect(text, `${source}: a step is missing from the page — "${step.slice(0, 60)}…"`).toContain(asRendered.trim());
        }
      }
    });
  }

  it("still renders the credential blocks for a paste-a-key source", async () => {
    // The other half of the same renderer: teaching it about oauth must not have
    // cost the sources that were working before.
    const text = plain(await render("stripe"));
    const entry = catalogEntry("stripe")!;
    for (const field of entry.guide!.fields) {
      expect(text, `stripe: credential block "${field.title}" vanished`).toContain(field.title);
    }
  });

  it("prints the date the steps were checked", async () => {
    // A guide nobody can date is a guide nobody can audit — the page's own rule.
    const text = plain(await render("meta-ads"));
    expect(text).toContain(catalogEntry("meta-ads")!.guide!.readOn);
  });
});
