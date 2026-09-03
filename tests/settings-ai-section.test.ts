import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * `SettingsPage` is an async server component that calls `requireOrg()` and
 * reads the database directly through several parallel WorkOS + Drizzle
 * calls (see the page's own comments) — rendering it here would mean
 * rebuilding most of its data layer as mocks to check a handful of wiring
 * facts. Pinned on the source text instead, the same trade
 * `tests/connections-page.test.ts` makes for the same reason.
 */

const PAGE_PATH = "src/app/dashboard/settings/page.tsx";
const SECTION_PATH = "src/app/dashboard/settings/AiAssistantsSection.tsx";

describe("Settings page wires in AiAssistantsSection", () => {
  const page = readFileSync(PAGE_PATH, "utf8");

  it("imports it", () => {
    expect(page).toMatch(/import\s*\{\s*AiAssistantsSection\s*\}\s*from\s*"\.\/AiAssistantsSection"/);
  });

  it("renders it", () => {
    expect(page).toContain("<AiAssistantsSection");
  });

  it("passes the same emailByUser map the Members list uses (finding #8)", () => {
    const idx = page.indexOf("<AiAssistantsSection");
    const block = page.slice(idx, page.indexOf("/>", idx));
    expect(block).toMatch(/emailByUser=\{emailByUser\}/);
  });
});

describe("AiAssistantsSection", () => {
  const src = readFileSync(SECTION_PATH, "utf8");

  it("renders a CopyField with the resource URL", () => {
    expect(src).toContain("<CopyField");
    // Sabotage: pass a literal string or a differently-named variable to
    // `value` and this still finds `<CopyField`, but not this line — the
    // field must actually carry the resolved resource URL, not a stand-in.
    const idx = src.indexOf("<CopyField");
    const block = src.slice(idx, src.indexOf("/>", idx));
    expect(block).toMatch(/value=\{resourceUrl\}/);
  });

  it("gates the workspace switch form on isAdmin", () => {
    // The CALL SITE, not the import: `setAiAssistantsEnabledAction` also
    // appears in the top-of-file import line, which carries no `isAdmin`
    // guard at all and would make this pin vacuous.
    const formIdx = src.indexOf("await setAiAssistantsEnabledAction");
    expect(formIdx, "the workspace switch form was not found").toBeGreaterThan(-1);
    // Sabotage: drop the `isAdmin &&` guard and the switch renders for every
    // member, not just an owner / manage_workspace holder.
    const before = src.slice(Math.max(0, formIdx - 400), formIdx);
    expect(before).toMatch(/isAdmin\s*&&/);
  });

  it("renders the on/off state sentence for every viewer, not just isAdmin (fix round 1, finding #2)", () => {
    // A non-admin walked through the connect steps needs to know whether the
    // switch is even on before trying — the sentence must sit OUTSIDE the
    // isAdmin gate that wraps the switch's form and button.
    const sentenceIdx = src.indexOf("AI assistants are currently");
    expect(sentenceIdx, "the on/off sentence was not found").toBeGreaterThan(-1);
    // The nearest `isAdmin && (` BEFORE the form's call site is the gate that
    // must NOT also enclose the sentence. Sabotage: move the sentence back
    // inside `{isAdmin && (...)}` and this fails because the gate then opens
    // before the sentence too.
    const formIdx = src.indexOf("await setAiAssistantsEnabledAction");
    const gateIdx = src.lastIndexOf("isAdmin && (", formIdx);
    expect(gateIdx, "the isAdmin gate around the switch was not found").toBeGreaterThan(-1);
    expect(sentenceIdx).toBeLessThan(gateIdx);
  });

  it("redirects with an error param when the switch action refuses, instead of failing silently (finding #3)", () => {
    const idx = src.indexOf("await setAiAssistantsEnabledAction");
    expect(idx, "the switch action call was not found").toBeGreaterThan(-1);
    // Sabotage: drop the `if (!r.ok) redirect(...)` line and a refusal (e.g. a
    // non-admin somehow reaching the form) re-renders with no feedback at all.
    const after = src.slice(idx, idx + 300);
    expect(after).toMatch(/if\s*\(!r\.ok\)/);
    expect(after).toMatch(/ai_error/);
  });

  it("redirects with an error param when disconnecting refuses, instead of failing silently (finding #3)", () => {
    const idx = src.indexOf("await disconnectAssistantAction");
    expect(idx, "the disconnect action call was not found").toBeGreaterThan(-1);
    const after = src.slice(idx, idx + 300);
    expect(after).toMatch(/if\s*\(!r\.ok\)/);
    expect(after).toMatch(/ai_error/);
  });

  it("shows the member's email, falling back to their id, instead of a raw WorkOS id (finding #8)", () => {
    // Sabotage: read `g.userId` straight into the row label and this fails —
    // `emailByUser` must be consulted first.
    expect(src).toMatch(/emailByUser\.get\(g\.userId\)/);
  });

  it("tells people removal cuts off the assistant within a minute", () => {
    expect(src).toMatch(/within a minute/);
  });

  it("reads the client count off each listGrants row via `.clients`", () => {
    // Sabotage: hard-code a count, or read some other field, and this fails
    // to find the one spelling `listGrants`'s GrantRow actually carries.
    expect(src).toMatch(/\.clients\b/);
  });

  it("never renders credentials, and shows a plain sentence when MCP is disabled", () => {
    expect(src).toMatch(/not enabled on this deployment yet/);
    expect(src).not.toMatch(/credentialsEncrypted|signingSecretEncrypted/);
  });
});
