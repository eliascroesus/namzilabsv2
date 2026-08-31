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
   * ONE COLOUR, BECAUSE THERE IS ONE THEME.
   *
   * This was a media-query pair — a light answer and a dark one — for as long
   * as the product had two themes. Keeping the pair now would mean the address
   * bar on a machine set to light rendered `#f5f5f5` above an app that is
   * `#0f1011` on every machine, which is the one piece of chrome CSS cannot
   * reach: the browser paints it from this tag alone.
   *
   * Pinned to `--background` by tests/design-swatches.test.ts rather than
   * trusted, because it must be a build-time literal — Next cannot read a
   * custom property here — and a surface change that misses it leaves a pale
   * band above the app on mobile with nothing failing.
   */
  themeColor: "#0f1011",
  colorScheme: "dark",
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
    // `suppressHydrationWarning` AND THE BLOCKING SCRIPT ARE BOTH GONE.
    //
    // next-themes existed to solve two problems, and a one-theme app has
    // neither. It injected a script into <head> to stamp the theme class before
    // the first paint (there is no stored preference to read), which in turn
    // mutated <html> before hydration and forced the suppression above (there
    // is nothing mutating it now). The theme is declared in CSS: `color-scheme`
    // on <html> and the roles in `:root`, both present in the first byte.
    <html lang="en">
      <body className={inter.variable}>
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
        <TooltipProvider>
          <AuthKitProvider initialAuth={initialAuth}>{children}</AuthKitProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
