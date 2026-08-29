import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE KIT PAGE'S INDEX POINTS AT SECTIONS THAT EXIST.
 *
 * `/design` grew a sticky table of contents when it grew past twenty sections,
 * and a table of contents has exactly one failure mode: a link that scrolls
 * nowhere. It is also a silent one — an `href="#s-marks"` with no `id="s-marks"`
 * on the page does not throw, does not warn, and does not fail a build. It just
 * does nothing when clicked, which is the kind of defect that survives every
 * review because nobody clicks all twenty-two.
 *
 * Both halves derive their string from the same `sectionId()`, so the only way
 * they can disagree is if a section is added, renamed or removed without the
 * list moving with it. That is precisely what this checks.
 */
const root = join(__dirname, "..");
const page = readFileSync(join(root, "src/app/design/page.tsx"), "utf8");

/** Every `title` passed to a `<Section>` on the page, in source order. */
function rendered(): string[] {
  // Cut the SECTIONS array off first: its entries are string literals that
  // would otherwise be indistinguishable from a title attribute's value.
  const body = page.split("const SECTIONS")[0];
  const out: string[] = [];
  for (const m of body.matchAll(/<Section\s+([^>]*?)>/gs)) {
    const t = m[1].match(/title="([^"]+)"/);
    if (t) out.push(t[1]);
  }
  return out;
}

/** Every title listed in the index's `SECTIONS` array. */
function listed(): string[] {
  const block = page.split("const SECTIONS = [")[1]?.split("];")[0] ?? "";
  return [...block.matchAll(/^\s*"([^"]+)",\s*$/gm)].map((m) => m[1]);
}

describe("the /design index and the page it indexes", () => {
  const a = rendered();
  const b = listed();

  it("finds both (a parse matching nothing would pass everything)", () => {
    // The guard that makes the rest of this file mean something: if the page
    // is reformatted and either regex stops matching, THIS fails rather than
    // two empty arrays comparing equal.
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(b.length).toBeGreaterThanOrEqual(20);
  });

  it("lists every section that is rendered", () => {
    expect(a.filter((t) => !b.includes(t))).toEqual([]);
  });

  it("renders every section that is listed", () => {
    expect(b.filter((t) => !a.includes(t))).toEqual([]);
  });

  it("keeps them in the same order, so the index reads down the page", () => {
    expect(b).toEqual(a);
  });
});

/**
 * THE GALLERY COVERS THE DIRECTORY.
 *
 * The reason half the kit shipped unused is that the kit PAGE only showed the
 * half somebody had found interesting — a primitive nobody can see is a
 * primitive nobody reaches for. So the gallery's job is coverage, and this is
 * the assertion that keeps it honest when the 32nd primitive lands.
 */
describe("the gallery imports every primitive in src/components/ui", () => {
  const gallery = readFileSync(join(root, "src/app/design/gallery.tsx"), "utf8");
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(join(root, "src/components/ui"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => f.replace(/\.tsx$/, ""));

  it("finds the primitives", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  /**
   * One is deliberately absent, and it is named here rather than silently
   * skipped. `legal` is a whole-page template for /privacy and /terms — it
   * renders its own <main>, heading and back link, so a specimen of it inside
   * a gallery cell would be a page nested in a page.
   */
  const OFF_GALLERY: Record<string, string> = {
    legal: "a whole-page template, not a component — it renders its own <main>",
  };

  for (const f of files) {
    const why = OFF_GALLERY[f];
    it(`${why ? "deliberately omits" : "shows"} ui/${f}`, () => {
      const imported = gallery.includes(`@/components/ui/${f}"`);
      if (why) return expect(imported, `${f} is listed as off-gallery: ${why}`).toBe(false);
      expect(imported, `ui/${f}.tsx is not on the kit page — that is how a primitive ships unused`).toBe(true);
    });
  }
});
