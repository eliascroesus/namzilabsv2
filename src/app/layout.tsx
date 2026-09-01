import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * THE FALLBACK, NOT THE FACE.
 *
 * The interface is set in SF Pro, which is Apple-licensed and cannot be shipped
 * — `--font-sans` reaches the copy already installed on every Mac and iPhone
 * through `-apple-system`. Inter is what everyone else gets, and next/font
 * self-hosts it at build time: no runtime fetch, no layout shift, no
 * third-party request.
 *
 * It is still loaded unconditionally, which is deliberate. Serving it only to
 * non-Apple clients would mean sniffing the user agent to pick a stylesheet,
 * and the file is ~40KB subsetted against a font stack that has to be correct
 * on the first paint.
 *
 * INSTRUMENT SANS IS GONE. It ran page titles, the landing hero and the metric
 * numeral, on the argument that a product set entirely in one face is the house
 * style of every dashboard built since 2019. That argument was answered rather
 * than abandoned: the distinction this interface draws is between the chrome
 * and the NUMBER, and 36px at -0.03em against a 14px interface already carries
 * it. A second family was buying separation the size step had paid for, at the
 * cost of a second font request.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

import { ThemeProvider } from "@/components/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
import { withAuth } from "@workos-inc/authkit-nextjs";
import type { UserInfo, NoUserInfo } from "@workos-inc/authkit-nextjs";

export const metadata: Metadata = {
  title: "Namzilabs — all your tools' data in one place",
  description: "Unify Calendly, Close, Instantly, Google Sheets and more into one reliable dashboard.",
};

/**
 * `themeColor` paints the browser's own chrome — the address bar on mobile
 * Safari and Chrome — to match the page instead of leaving a grey band above
 * a white app. `colorScheme` is the same declaration as globals.css makes on
 * <html>, stated here so Next emits the meta tag alongside it.
 *
 * `viewportFit: "cover"` lets the layout reach under a notch, which is only
 * safe because AppFrame pads the rail by `env(safe-area-inset-*)` — without
 * that pairing the navigation would sit beneath the camera cutout.
 */
export const viewport: Viewport = {
  /**
   * ONE COLOUR PER THEME, and the pair is back because the themes are.
   *
   * This is the one piece of chrome CSS cannot reach — mobile Safari and Chrome
   * paint their own address bar from this tag alone — so a single value leaves
   * it mismatched for everybody on the other theme.
   *
   * IT KEYS OFF `prefers-color-scheme`, WHICH IS NOT THE QUESTION THE APP ASKS.
   * The app's theme is a stored preference that DEFAULTS to the OS; this tag can
   * only see the OS. So somebody who has explicitly chosen light on a dark
   * machine gets a dark address bar above a light app. That is a browser
   * limitation rather than a bug we can close — the tag is read before any
   * script runs, which is the whole reason it exists.
   *
   * Both are pinned to `--background` by tests/design-swatches.test.ts rather
   * than trusted, because they must be build-time literals — Next cannot read a
   * custom property here — and a surface change that misses one leaves a
   * mismatched band above the app on mobile with nothing failing.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f9" },
    { media: "(prefers-color-scheme: dark)", color: "#1b191a" },
  ],
  colorScheme: "light dark",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Seed the client provider with server-known auth so it skips the initial
  // client fetch. Wrapped defensively so build-time rendering never fails.
  let initialAuth: Omit<UserInfo | NoUserInfo, "accessToken"> | undefined;
  try {
    const { accessToken: _accessToken, ...rest } = await withAuth();
    initialAuth = rest;
  } catch {
    initialAuth = undefined;
  }

  return (
    // `suppressHydrationWarning` IS REQUIRED, NOT DEFENSIVE: next-themes stamps
    // the theme class onto <html> from a blocking script before React hydrates,
    // so this one element is knowingly different on the client. See theme.tsx
    // for why that script has to be blocking — without it every cold load
    // paints the default theme for a frame, which is a white flash for anyone
    // in dark mode.
    // THE FONT VARIABLE GOES ON <html>, NOT <body>, AND THAT IS A BUG FIX
    // RATHER THAN A TIDY-UP.
    //
    // `--font-sans` is declared in `@theme`, which Tailwind emits at `:root` —
    // and its value contains `var(--font-inter)`. next/font defines that
    // variable on whatever element carries `inter.variable`. With the class on
    // <body>, the reference at `:root` was UNRESOLVABLE, which makes the whole
    // custom property invalid at computed-value time: `--font-sans` computed to
    // the empty string, and the empty string then INHERITED down to <body>,
    // where `--font-inter` was defined and could no longer help.
    //
    // The visible result was that every surface in the product rendered in the
    // browser's generic `ui-sans-serif` rather than the stack this file names.
    // On a Mac that resolves to SF Pro and looks nearly right, which is why it
    // survived: it was wrong on every other platform and nothing failed.
    // Measured with getComputedStyle, not inferred.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* The first stop on every tab order. Without it, reaching a page's
            content by keyboard means tabbing the whole navigation rail again
            on every single navigation. Hidden until focused (globals.css). */}
        <a
          href="#main"
          className="skip-link rounded-control bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-panel"
        >
          Skip to content
        </a>
        {/* `delayDuration={0}` is set in the component, not here: this product's
            tooltips label icon-only controls, and a control whose only label
            appears after a beat is a control you have to hover twice. The rail
            is icon-only at rest, so this is most of its labelling. */}
        <ThemeProvider>
          <TooltipProvider>
            <AuthKitProvider initialAuth={initialAuth}>{children}</AuthKitProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
