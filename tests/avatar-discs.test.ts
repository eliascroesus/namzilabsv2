import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY HAND-ROLLED INITIALS DISC WEARS THE SAME ROLE `ui/avatar.tsx` DOES.
 *
 * `AvatarFallback` renders an initial on `bg-avatar` plus the `--input`
 * outline (`border border-input`) — white with a grey ring on light, `#3A3A3A`
 * on dark — because that is the one fill the 4 Sep 2026 Figma names for every
 * avatar-shaped circle in the kit. Four call sites still built their own disc
 * on `bg-accent` or `bg-muted` before this pass: the account panel's trigger
 * avatar (`app-shell.tsx`), the profile page's own picture placeholder
 * (`profile/page.tsx`), and the pending-invitation row (`settings/page.tsx`).
 *
 * `settings/page.tsx` also draws a DIFFERENT disc for each active member —
 * the owner in `--primary`, everyone else in one of three decorative accent
 * tones (`AVATAR_TONES`), so people can tell each other apart in a list. That
 * is a deliberate, documented product choice (see the comment above
 * `AVATAR_TONES`'s call site) and not an accidental hand-roll of the avatar
 * role, so it is deliberately NOT converted here and this file does not pin
 * it away.
 *
 * Sabotage-verified: reverting any one disc below to its pre-fix fill fails
 * that file's assertion alone.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * Every `className="..."` literal in a source file. Plain double-quoted
 * strings only — the codebase's hand-rolled discs are all written this way,
 * never through `cn(...)`, so this is the actual markup a disc leaves behind
 * rather than a guess at how `cn` might compose it.
 */
function classLiterals(src: string): string[] {
  return [...src.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
}

/** A class string that reads as a hand-rolled disc: a circle carrying an initial. */
function isDisc(cls: string): boolean {
  return /\brounded-full\b/.test(cls) && /\bfont-semibold\b/.test(cls);
}

/**
 * `bg-accent` and `bg-muted` as their OWN class, not as a prefix of a
 * decorative token — `bg-accent-peri`/`-pink`/`-orange` are a different,
 * sanctioned family and must not trip this.
 */
const OFF_ROLE_FILL = /\bbg-(?:accent|muted)\b(?!-)/;

const FILES = [
  "src/components/app-shell.tsx",
  "src/app/dashboard/profile/page.tsx",
  "src/app/dashboard/settings/page.tsx",
];

describe("every avatar-shaped initials disc uses the --avatar role", () => {
  for (const file of FILES) {
    it(`${file} renders at least one disc through bg-avatar`, () => {
      const src = read(file);
      const discs = classLiterals(src).filter(isDisc);
      expect(discs.length, `${file}: found no rounded-full + font-semibold disc to check`).toBeGreaterThan(0);
      expect(discs.some((c) => /\bbg-avatar\b/.test(c)), `${file}: no disc carries bg-avatar`).toBe(true);
    });

    it(`${file} has no initials disc still filled from bg-accent or bg-muted`, () => {
      const src = read(file);
      const offenders = classLiterals(src).filter((c) => isDisc(c) && OFF_ROLE_FILL.test(c));
      expect(offenders, `${file}: a disc still hand-rolls its fill — ${JSON.stringify(offenders)}`).toEqual([]);
    });
  }

  it("app-shell.tsx's disc also carries the --input outline and --foreground ink, like AvatarFallback", () => {
    const src = read("src/components/app-shell.tsx");
    const disc = classLiterals(src).find((c) => isDisc(c) && /\bbg-avatar\b/.test(c));
    expect(disc).toMatch(/\bborder-input\b/);
    expect(disc).toMatch(/\btext-foreground\b/);
  });

  it("profile/page.tsx's disc also carries the --input outline and --foreground ink", () => {
    const src = read("src/app/dashboard/profile/page.tsx");
    const disc = classLiterals(src).find((c) => isDisc(c) && /\bbg-avatar\b/.test(c));
    expect(disc).toMatch(/\bborder-input\b/);
    expect(disc).toMatch(/\btext-foreground\b/);
  });

  it("settings/page.tsx keeps the pending row's dashed edge — the disc's OWN 'not yet' signal — while its fill and ink follow the role", () => {
    const src = read("src/app/dashboard/settings/page.tsx");
    const disc = classLiterals(src).find((c) => isDisc(c) && /\bbg-avatar\b/.test(c));
    expect(disc).toMatch(/\bborder-dashed\b/);
    expect(disc).toMatch(/\btext-foreground\b/);
  });

  it("leaves the member row's per-person colour untouched — a documented choice, not a stray role", () => {
    const src = read("src/app/dashboard/settings/page.tsx");
    expect(src).toMatch(/AVATAR_TONES/);
    expect(src).toMatch(/m\.role === "owner" \? "bg-primary text-primary-foreground" : avatarTone\(m\.email\)/);
  });
});
