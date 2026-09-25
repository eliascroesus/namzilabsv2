import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { monoColor, scanAppIcons } from "../scripts/lib/app-icons.mjs";
import { uploadedIcon, uploadedIconMono } from "@/connectors/app-icons";
import { logoColorOnDark } from "@/components/flow/controls/source-style";
import { BrandLogo, hasBrandLogo } from "@/components/brand-logo";
import { SourceMark } from "@/components/source-mark";

/**
 * THE APP-ICONS FOLDER — drop `instantly.png` in `public/app-icons/`, and every
 * surface that draws Instantly draws that file instead of two letters.
 *
 * Three links to pin: the build's scan of the folder, the match from a file
 * name to an app (forgiving, because the owner names files by what the app is
 * CALLED, and nobody should have to know Google Ads is `gads`), and the
 * components actually preferring the upload.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const env = (entries: Array<{ key: string; src: string; mono?: string }>) => vi.stubEnv("APP_ICONS", JSON.stringify(entries));

describe("the build's scan of the folder", () => {
  it("lists images, skips everything else, and versions each by its content", () => {
    const dir = mkdtempSync(join(tmpdir(), "app-icons-"));
    writeFileSync(join(dir, "instantly.png"), "png-bytes");
    writeFileSync(join(dir, "Google Ads.svg"), "<svg/>");
    writeFileSync(join(dir, "README.md"), "not an icon");
    writeFileSync(join(dir, ".DS_Store"), "junk");
    const found = scanAppIcons(dir);
    expect(found.map((f) => f.key)).toEqual(["Google Ads", "instantly"]);
    expect(found[0].src).toMatch(/^\/app-icons\/Google%20Ads\.svg\?v=[0-9a-f]{8}$/);
    // Same bytes, same version; new bytes, new version — so a replaced file is
    // re-fetched and an untouched one keeps its cache.
    const before = found[1].src;
    writeFileSync(join(dir, "instantly.png"), "better-png-bytes");
    expect(scanAppIcons(dir)[1].src).not.toBe(before);
  });

  it("answers no icons, not a failed build, when the folder is missing", () => {
    expect(scanAppIcons(join(tmpdir(), "no-such-folder-here"))).toEqual([]);
  });
});

describe("a file finds its app", () => {
  it("by slug or by name, whatever the case and punctuation", () => {
    env([
      { key: "Instantly", src: "/app-icons/Instantly.png?v=1" },
      { key: "Google Ads", src: "/app-icons/Google%20Ads.svg?v=2" },
      { key: "retell", src: "/app-icons/retell.png?v=3" },
      { key: "Cal.com", src: "/app-icons/Cal.com.png?v=4" },
    ]);
    expect(uploadedIcon("instantly")).toBe("/app-icons/Instantly.png?v=1");
    expect(uploadedIcon("gads")).toBe("/app-icons/Google%20Ads.svg?v=2");
    expect(uploadedIcon("retell")).toBe("/app-icons/retell.png?v=3");
    expect(uploadedIcon("calcom")).toBe("/app-icons/Cal.com.png?v=4");
    expect(uploadedIcon("typeform")).toBeUndefined();
  });

  it("ignores a file that names no app, and anything not served from the folder", () => {
    env([
      { key: "my-holiday-photo", src: "/app-icons/my-holiday-photo.jpg?v=1" },
      { key: "instantly", src: "https://evil.example/pixel.png" },
    ]);
    expect(uploadedIcon("instantly")).toBeUndefined();
  });
});

describe("the marks prefer an upload", () => {
  it("draws the uploaded file where the two-letter tile used to be", () => {
    expect(renderToStaticMarkup(createElement(SourceMark, { source: "instantly", size: 20 }))).not.toContain("<img");
    env([{ key: "instantly", src: "/app-icons/instantly.png?v=9" }]);
    const html = renderToStaticMarkup(createElement(SourceMark, { source: "instantly", size: 20 }));
    expect(html).toContain('<img src="/app-icons/instantly.png?v=9"');
    expect(html).toContain('alt="Instantly"');
    expect(hasBrandLogo("instantly")).toBe(true);
  });

  it("rounds an upload's corners a little, at every size", () => {
    // Full-bleed square uploads read sharp drawn bare; about a fifth of the side.
    env([{ key: "instantly", src: "/app-icons/instantly.png?v=9" }]);
    expect(renderToStaticMarkup(createElement(SourceMark, { source: "instantly", size: 44 }))).toContain("border-radius:10px");
    expect(renderToStaticMarkup(createElement(SourceMark, { source: "instantly", size: 20 }))).toContain("border-radius:4px");
    env([{ key: "retell", src: "/app-icons/retell.svg?v=1", mono: "#00122e" }]);
    expect(renderToStaticMarkup(createElement(SourceMark, { source: "retell", size: 28 }))).toContain("border-radius:6px");
  });

  it("lets an upload replace a built-in mark too", () => {
    env([{ key: "calendly", src: "/app-icons/calendly.svg?v=1" }]);
    expect(renderToStaticMarkup(createElement(BrandLogo, { source: "calendly", size: 24 }))).toContain(
      'src="/app-icons/calendly.svg?v=1"',
    );
  });

  it("changes nothing while the folder is empty", () => {
    env([]);
    expect(hasBrandLogo("instantly")).toBe(false);
    expect(hasBrandLogo("calendly")).toBe(true);
  });
});

/**
 * A ONE-COLOUR MARK ON A DARK GROUND.
 *
 * Logos are drawn bare, so an uploaded mark inherits whatever surface it lands
 * on — and Retell's navy `#00122E` is 1.1:1 on the dark theme's `#121212`,
 * which is to say invisible. The build now reads a one-colour SVG's paint, and
 * the mark is painted per ground instead of pasted: its own colour on light,
 * white on dark. A logo with more than one colour, or any raster, is never
 * touched.
 */
describe("a one-colour upload is painted for its ground", () => {
  it("reads the single paint of an SVG, and refuses anything it cannot be sure of", () => {
    expect(monoColor('<svg fill="none"><path fill="#00122E"/><path fill="#00122e"/></svg>')).toBe("#00122e");
    expect(monoColor("<svg><style>.a{fill:#1A73E8}</style><path class=\"a\"/></svg>")).toBe("#1a73e8");
    expect(monoColor('<svg><path fill-rule="evenodd" fill="#123"/></svg>')).toBe("#112233");
    expect(monoColor('<svg><path d="M0 0h1"/></svg>')).toBe("#000000"); // SVG's default paint
    expect(monoColor('<svg><path fill="#ffffff"/><path fill="#000000"/></svg>')).toBeUndefined();
    expect(monoColor('<svg><linearGradient id="g"><stop stop-color="#f00"/></linearGradient><path fill="url(#g)"/></svg>')).toBeUndefined();
    expect(monoColor('<svg><path fill="rgb(0,0,0)"/></svg>')).toBeUndefined();
  });

  it("marks only one-colour SVGs in the build's list — never a bitmap", () => {
    const dir = mkdtempSync(join(tmpdir(), "app-icons-mono-"));
    writeFileSync(join(dir, "retell.svg"), '<svg fill="none"><path fill="#00122E"/></svg>');
    writeFileSync(join(dir, "stripe.svg"), '<svg><path fill="#635BFF"/><path fill="#ffffff"/></svg>');
    writeFileSync(join(dir, "tally.png"), "png-bytes");
    const byKey = Object.fromEntries(scanAppIcons(dir).map((e) => [e.key, e]));
    expect(byKey.retell.mono).toBe("#00122e");
    expect(byKey.stripe.mono).toBeUndefined();
    expect(byKey.tally.mono).toBeUndefined();
  });

  it("keeps a colour the dark ground can show, and reverses one it cannot", () => {
    expect(logoColorOnDark("#00122e")).toBe("#ffffff");
    expect(logoColorOnDark("#000000")).toBe("#ffffff");
    expect(logoColorOnDark("#568cff")).toBe("#568cff");
  });

  it("paints the mark through a mask, navy on light and white on dark", () => {
    env([{ key: "retell", src: "/app-icons/retell.svg?v=1", mono: "#00122e" }]);
    const html = renderToStaticMarkup(createElement(SourceMark, { source: "retell", size: 20 }));
    expect(html).not.toContain("<img");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Retell AI"');
    expect(html).toContain("mask-image:url(&quot;/app-icons/retell.svg?v=1&quot;)");
    expect(html).toContain("light-dark(#00122e, #ffffff)");
    // The fallback a browser without light-dark() keeps: the file's own colour.
    expect(html).toContain("background-color:#00122e");
  });

  it("leaves a many-coloured upload exactly as it was drawn", () => {
    env([{ key: "retell", src: "/app-icons/retell.svg?v=1" }]);
    expect(renderToStaticMarkup(createElement(BrandLogo, { source: "retell", size: 20 }))).toContain(
      '<img src="/app-icons/retell.svg?v=1"',
    );
  });

  it("accepts nothing but a plain hex from the list, so it cannot carry CSS", () => {
    env([{ key: "retell", src: "/app-icons/retell.svg?v=1", mono: "red;background:url(https://evil.example)" }]);
    expect(uploadedIconMono("retell")).toBeUndefined();
    expect(renderToStaticMarkup(createElement(BrandLogo, { source: "retell", size: 20 }))).toContain("<img");
  });
});
