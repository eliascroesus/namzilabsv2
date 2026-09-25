import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { scanAppIcons } from "../scripts/lib/app-icons.mjs";
import { uploadedIcon } from "@/connectors/app-icons";
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

const env = (entries: Array<{ key: string; src: string }>) => vi.stubEnv("APP_ICONS", JSON.stringify(entries));

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
