import { Fragment } from "react";

/**
 * A SETUP STEP THAT CAN CARRY A LINK.
 *
 * Guide steps used to be plain strings, so the one thing a step most often
 * needs to say — "go to this exact page" — arrived as text the reader had to
 * retype. `notion.so/profile/integrations` in a numbered list is a URL you
 * copy by hand and get wrong; the same words as an anchor are one click.
 *
 * The syntax is markdown's, and ONLY markdown's link: `[label](https://url)`.
 * Nothing else is interpreted — no bold, no code, no images. A guide is prose
 * with the occasional door in it, and a full markdown renderer would be a
 * parser, a sanitiser and a styling argument in exchange for emphasis nobody
 * asked for.
 *
 * WHY `https:` IS ENFORCED rather than assumed. These strings live in this
 * repo, so this is not a defence against an attacker — it is a defence against
 * a typo that silently produces a dead or dangerous anchor. `javascript:` and
 * `data:` hrefs are how a link becomes a script, and a relative href in a page
 * that is served at `/docs/<source>` resolves somewhere nobody intended. A
 * malformed link renders as its literal text, which is visible in review and
 * caught by the test that walks every guide in the catalog.
 */

/** One run of a guide string: prose, or a link with its label. */
export type GuideSegment = { text: string } | { label: string; href: string };

// Deliberately narrow: a label with no brackets of its own, and an https URL
// with no whitespace or closing paren. Anything else is left as literal text.
const LINK = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;

/**
 * Split a guide string into prose and links.
 *
 * Exported for the test that walks every guide in the catalog: a link that
 * fails to parse is indistinguishable from prose on the page, so the only way
 * to notice a malformed one is to assert on the segments.
 */
export function parseGuideText(input: string): GuideSegment[] {
  const out: GuideSegment[] = [];
  let last = 0;
  // `matchAll` rather than a stateful `exec` loop: LINK carries /g, and a
  // shared lastIndex across calls is the classic way this returns different
  // answers for the same input on the second render.
  for (const m of input.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: input.slice(last, at) });
    out.push({ label: m[1], href: m[2] });
    last = at + m[0].length;
  }
  if (last < input.length) out.push({ text: input.slice(last) });
  return out;
}

/**
 * Render a guide string, turning `[label](https://url)` into a real anchor.
 *
 * Links open in a new tab: the reader is mid-setup with a token half-pasted,
 * and navigating the page away from under them loses what they were doing.
 */
export function GuideText({ children }: { children: string }) {
  return (
    <>
      {parseGuideText(children).map((seg, i) =>
        "href" in seg ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {seg.label}
          </a>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}
