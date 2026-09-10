"use client";

import { Contrast, Monitor, Moon, Sun } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PERIOD_PILL, PERIOD_TRACK } from "@/components/ui/page";

/**
 * THE THEME, AND THE TWO THINGS THAT ARE HARD ABOUT IT.
 *
 * 1. THE FLASH. A theme stored in localStorage is not known to the server, so
 *    the first paint is always the default one and the correct theme arrives a
 *    frame later — a white flash on every cold load for anyone in dark mode.
 *    `next-themes` solves it the only way it can be solved: a tiny blocking
 *    script in <head> that reads storage and stamps the class on <html> BEFORE
 *    the first paint. That is why this is a dependency rather than ten lines of
 *    useState.
 *
 * 2. THE HYDRATION MISMATCH. That script mutates <html> before React hydrates,
 *    so the server's markup and the client's disagree by construction. The
 *    `suppressHydrationWarning` on <html> in `layout.tsx` is not papering over
 *    a bug — it is telling React about the one element we deliberately let the
 *    document edit first.
 *
 * PER DEVICE, NOT PER ACCOUNT. The preference lives in localStorage, which
 * means choosing dark on a laptop does not change a phone — the arrangement
 * Vercel, Figma and Notion all use. It also means the landing and the legal
 * pages honour it while signed out, which a column on the user row could not.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    /**
     * `themes` HAS TO BE SPELLED OUT NOW, AND THAT IS THE WHOLE COST OF `mix`.
     *
     * next-themes defaults this list to `["light", "dark"]` and validates
     * against it: a `setTheme("mix")` with the default list is accepted into
     * storage and then never stamped on <html>, so the choice appears to save
     * and does nothing — silently, with no error anywhere. Naming all three
     * (plus `system`, which `enableSystem` would otherwise append on its own)
     * is what makes the third mode real.
     *
     * `system` STILL RESOLVES TO TWO. The OS reports light or dark and has no
     * opinion about a rail, so following the system can only ever land on one
     * of those; `mix` is reachable by choosing it, which is the honest
     * arrangement — see the note on `CHOICES`.
     */
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={["light", "mix", "dark", "system"]}
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}

/**
 * EXPORTED, because the rail's search offers the same three and a second copy
 * of them would drift — a fourth choice, or a renamed one, has to reach both
 * surfaces or the palette starts lying about what the product can do. The rail
 * imports the values and picks its own glyphs; `Icon` rides along for callers
 * that want the same picture this control draws.
 */
export const CHOICES = [
  { value: "light", label: "Light", Icon: Sun },
  /**
   * THE THIRD MODE — a near-black rail against the light working surface.
   *
   * It is not a half-measure between the other two, which is why it is not
   * called "auto" or "dim": it is a deliberate arrangement the 10 September
   * Figma draws in full (node 35:6331), and the one this product actually
   * shipped as its light theme for two days. Linear, Height and Vercel's
   * dashboard all hold navigation still in a dark column while the work stays
   * bright; some people read that as focus and some read it as noise.
   *
   * `Contrast` — the half-filled disc — because the glyph has to say "one side
   * dark, one side light" rather than "between light and dark". A dimmed moon
   * would say the second thing.
   *
   * IT SITS BETWEEN LIGHT AND DARK because the rungs are ordered by how much
   * near-black is on the screen, so the control reads as a ramp rather than as
   * a bag of options.
   */
  { value: "mix", label: "Mix", Icon: Contrast },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * THE CONTROL, AND WHY IT IS FOUR OPTIONS RATHER THAN A SWITCH.
 *
 * A toggle can only hold two states, so shipping one means quietly dropping
 * "follow the OS" — which is the state most people are actually in, and the one
 * that keeps the app in step with everything else on their machine when they
 * flip their system at sunset. The previous control was a toggle for exactly
 * that reason and it made `system` a starting point you could never get back to.
 *
 * FOUR RUNGS SINCE `mix` LANDED, and the same argument covers it: the OS
 * cannot report a preference about the rail, so `mix` is unreachable from
 * anything that only follows the system. The moon in the top bar stays a
 * two-state quick toggle (light ↔ dark) on the same grounds a switch was
 * rejected here — one glyph cannot say which of four states it is in — so this
 * is the only control that can reach every mode, and `nav-search.tsx` reads
 * the same list so the palette can too.
 *
 * IT IS THE PRODUCT'S OWN SEGMENTED CONTROL — `PERIOD_TRACK` / `PERIOD_PILL`,
 * the same pair the range picker and the calendar's month stepper wear. A
 * settings page that invents a fourth kind of segmented control is how a kit
 * grows a fifth.
 *
 * `mounted` IS NOT DEFENSIVE EITHER. `useTheme()` returns undefined on the
 * server and on the first client render, so reading it to decide which pill is
 * lit renders one answer on the server and another after hydration — React
 * throws, and in production it silently discards the markup. Rendering the
 * track with no pill lit until mount is a shape change nobody sees; getting it
 * wrong is a hydration error on the settings page.
 */
export function ThemeChoice({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(PERIOD_TRACK, "w-fit", className)}
    >
      {CHOICES.map(({ value, label, Icon }) => {
        const on = mounted && theme === value;
        return (
          /* `Button`, NOT a raw <button> with a class string — and the radio
             semantics ride ON it rather than replacing it. `role` and
             `aria-checked` are ordinary props that spread through, so this
             stays one of the product's buttons while announcing itself as one
             of three mutually exclusive choices. Hand-rolling it would have
             needed an allowlist entry in `check-ui.ts`, and "it is a radio" is
             not a reason a Button cannot be one. */
          <Button
            key={value}
            variant="ghost"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(value)}
            className={cn(
              PERIOD_PILL,
              "gap-1.5",
              on
                ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon aria-hidden />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
