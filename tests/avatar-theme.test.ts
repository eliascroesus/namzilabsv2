import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the avatar and group-count circles share one fill", () => {
  it("AvatarFallback fills with --avatar, not --accent", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, null, createElement(AvatarFallback, null, "NA")),
    );
    expect(html).toMatch(/\bbg-avatar\b/);
    expect(html, "the old accent fill must be gone").not.toMatch(/\bbg-accent\b/);
    expect(html).toMatch(/\btext-foreground\b/);
  });

  it("AvatarGroupCount fills with the same --avatar, not --muted", () => {
    const html = renderToStaticMarkup(createElement(AvatarGroup, null, createElement(AvatarGroupCount, null, "+3")));
    expect(html).toMatch(/\bbg-avatar\b/);
    expect(html, "the old muted fill must be gone").not.toMatch(/\bbg-muted\b/);
    expect(html).toMatch(/\btext-foreground\b/);
  });
});

describe("the field comments no longer claim a 9999px radius that hasn't shipped since", () => {
  it("input.tsx does not say rounded-control is 9999px", () => {
    expect(read("src/components/ui/input.tsx")).not.toMatch(/9999px/);
  });
  it("input.tsx does not claim px-4 padding it doesn't use", () => {
    expect(read("src/components/ui/input.tsx")).not.toMatch(/\bpx-4\b/);
  });
  it("tabs.tsx does not say --radius-control is 9999px", () => {
    expect(read("src/components/ui/tabs.tsx")).not.toMatch(/9999px/);
  });
});
