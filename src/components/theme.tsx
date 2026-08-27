"use client";

import { Moon, Sun } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

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
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

/**
 * The toggle. Three states matter — light, dark, and "whatever the OS says" —
 * but a three-way control in the rail is a menu, and this is a button, so it
 * flips between the two explicit ones and lets `system` be the starting point
 * rather than a destination.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  /**
   * NOTHING RENDERS UNTIL MOUNT, and this is the one place that is right.
   *
   * `resolvedTheme` is undefined on the server — it cannot be anything else,
   * because the answer lives in the visitor's browser. Rendering a sun or a
   * moon before it is known means rendering the wrong one roughly half the
   * time and swapping it on hydration, which is exactly the flicker the
   * blocking script exists to prevent, reintroduced by the control that
   * advertises the feature. A same-sized placeholder holds the space so the
   * rail does not reflow when it arrives.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={mounted ? (dark ? "Switch to the light theme" : "Switch to the dark theme") : "Switch theme"}
      title={mounted ? (dark ? "Light theme" : "Dark theme") : undefined}
    >
      {mounted ? dark ? <Sun /> : <Moon /> : <span className="size-4" aria-hidden />}
    </Button>
  );
}
