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
    // The light theme's `--avatar` is WHITE — a white disc on a `#F7F8F9`
    // page has no edge of its own, so the circle needs the same `--input`
    // outline the spec gives every avatar/bell circle.
    expect(html, "a white avatar disc needs its --input outline").toMatch(/\bborder-input\b/);
  });

  it("AvatarGroupCount fills with the same --avatar, not --muted", () => {
    const html = renderToStaticMarkup(createElement(AvatarGroup, null, createElement(AvatarGroupCount, null, "+3")));
    expect(html).toMatch(/\bbg-avatar\b/);
    expect(html, "the old muted fill must be gone").not.toMatch(/\bbg-muted\b/);
    expect(html).toMatch(/\btext-foreground\b/);
    expect(html, "the same --input outline as AvatarFallback").toMatch(/\bborder-input\b/);
  });
});

describe("the field comments no longer claim a 9999px radius that hasn't shipped since", () => {
  it("input.tsx does not say rounded-control is 9999px", () => {
    expect(read("src/components/ui/input.tsx")).not.toMatch(/9999px/);
  });
  it("input.tsx's field comments name the padding and radius they actually use", () => {
    // An INTENT-LEVEL check rather than a ban on the literal string `px-4`: a
    // future field that legitimately grows to `px-4` for some real reason
    // should not fail a test that is really policing what the COMMENT
    // claims, not what padding is allowed to exist in the file. The FIELD
    // comment must name its real padding (`px-3`) and the Textarea comment
    // must name its real radius (`rounded-control`) — that is what "the
    // comment is true" means here.
    const source = read("src/components/ui/input.tsx");
    const fieldComment = source.match(/\/\*\*\s*\n \* A SINGLE-LINE FIELD[\s\S]*?\*\//)?.[0] ?? "";
    const textareaComment = source.match(/\/\*\*\s*\n \* THE MULTI-LINE FIELD[\s\S]*?\*\//)?.[0] ?? "";
    expect(fieldComment, "the FIELD comment must name its real padding").toMatch(/px-3/);
    expect(textareaComment, "the Textarea comment must name its real radius").toMatch(/rounded-control/);
  });
  it("tabs.tsx does not say --radius-control is 9999px", () => {
    expect(read("src/components/ui/tabs.tsx")).not.toMatch(/9999px/);
  });
});
