"use client";

import { Monitor, Moon, Sun } from "lucide-react";
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
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

const CHOICES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * THE CONTROL, AND WHY IT IS THREE OPTIONS RATHER THAN A SWITCH.
 *
 * A toggle can only hold two states, so shipping one means quietly dropping
 * "follow the OS" — which is the state most people are actually in, and the one
 * that keeps the app in step with everything else on their machine when they
 * flip their system at sunset. The previous control was a toggle for exactly
 * that reason and it made `system` a starting point you could never get back to.
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
                ? "bg-primary text-primary-foreground hover:bg-brand-500"
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
