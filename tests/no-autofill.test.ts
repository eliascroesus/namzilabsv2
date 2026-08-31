import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "@/components/ui/input";

/**
 * NOTHING IN THIS PRODUCT ASKS FOR A PASSWORD, SO NOTHING SHOULD BE OFFERED ONE.
 *
 * Every masked field here holds an API key or a personal access token — pasted
 * once from another tab, never typed again, and never saved in anyone's vault.
 * So a password manager filling one is wrong by construction: it drops some
 * unrelated site's credentials into a box that gets encrypted and sent to
 * Close or Calendly.
 *
 * It happened for months. The field said `autocomplete="off"`, which is the one
 * value browsers deliberately IGNORE on a masked field — Chrome, Safari and
 * Firefox all disregard it there because sites abused it to break legitimate
 * managers. And because every connector's connect form lives inside a collapsed
 * `<details>`, all seven are in the DOM the moment the Apps page loads: opening
 * the tab was enough to trigger a fill.
 *
 * The rendered attributes are the only place the fix is visible, so they are
 * the thing pinned. Each assertion below fails if one dialect is dropped.
 */
/**
 * Lower-cased, because React emits these props in the case they were WRITTEN —
 * `autoComplete="off"`, verbatim, in the real server-rendered page too (checked
 * against a running build, not assumed). HTML attribute names are
 * case-insensitive, so the browser reads it as `autocomplete` either way; what
 * these tests are about is the attribute being PRESENT and carrying the right
 * value, and an assertion that turned on its casing would fail for a reason
 * that has nothing to do with the bug.
 */
const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(Input, props)).toLowerCase();

describe("a masked field", () => {
  const masked = html({ type: "password", name: "cred_apiKey" });

  it("says new-password, the one value a browser honours on a masked field", () => {
    expect(masked).toContain('autocomplete="new-password"');
    // THE REGRESSION: "off" reads as a fix and is a no-op here.
    expect(masked).not.toContain('autocomplete="off"');
  });

  it("opts out in every manager's own dialect", () => {
    expect(masked).toContain('data-lpignore="true"'); // LastPass
    expect(masked).toContain('data-1p-ignore=""'); // 1Password
    expect(masked).toContain('data-bwignore="true"'); // Bitwarden
    expect(masked).toContain('data-form-type="other"'); // Dashlane
  });

  it("still renders as a masked field", () => {
    // The opt-out must not have quietly become "show the secret on screen".
    expect(masked).toContain('type="password"');
  });
});

describe("an ordinary field", () => {
  const plain = html({ name: "metric" });

  it("keeps the app-wide autofill default and carries no manager attributes", () => {
    expect(plain).toContain('autocomplete="off"');
    expect(plain).not.toContain("data-lpignore");
    expect(plain).not.toContain("data-1p-ignore");
  });

  it("still lets the one field that wants autofill have it", () => {
    // The teammate-invite email — a real address the browser legitimately knows.
    expect(html({ type: "email", autoComplete: "email" })).toContain('autocomplete="email"');
  });
});

describe("the connect form", () => {
  const page = readFileSync(join(__dirname, "..", "src", "app", "integrations", "page.tsx"), "utf8");

  it("does not re-pass autoComplete on its credential inputs", () => {
    // This is how the bug was written: a call site "helpfully" setting
    // `autoComplete="off"` overrides the default that actually works, and looks
    // more careful than the code without it.
    const credentialInput = page.match(/<Input\s+id=\{`cred-[\s\S]*?\/>/)?.[0] ?? "";
    expect(credentialInput).toContain('type="password"');
    expect(credentialInput).not.toContain("autoComplete");
  });

  it("marks the connection-name field too", () => {
    // A text box directly above a masked one is the shape a manager reads as
    // "username, password" — it gets filled with somebody's email otherwise.
    expect(page).toMatch(/name="name"[^/]*\{\.\.\.NO_AUTOFILL\}/);
  });
});

describe("an autofilled field, when one legitimately is", () => {
  const css = readFileSync(join(__dirname, "..", "src", "app", "globals.css"), "utf8");

  it("is repainted in the kit's own colours", () => {
    // The UA paints its own pale blue behind a filled input and outranks the
    // field's own background; the inset shadow is the only thing that covers
    // it. Without this, one filled box on a form renders as a glowing pale
    // slab — which on a near-black surface is louder than it ever was on white.
    //
    // `--control`, NOT `--card`. The cover has to be the colour of the thing
    // being covered, and an input is not a card: it is `--control` (#141518),
    // one step DOWN from the card it sits on, so a row of fields reads as
    // recessed slots. Painting `--card` here would leave every autofilled
    // field a visible step lighter than the empty one beside it.
    expect(css).toMatch(/input:-webkit-autofill[\s\S]{0,400}box-shadow:\s*0 0 0 1000px var\(--control\) inset/);
    expect(css).toMatch(/input:-webkit-autofill[\s\S]{0,400}-webkit-text-fill-color:\s*var\(--foreground\)/);
  });
});
