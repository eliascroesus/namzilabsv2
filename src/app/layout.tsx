import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Sans } from "next/font/google";
import "./globals.css";

/**
 * THE FONT IS THE BRAND. The app shipped on ui-sans-serif, which renders as
 * whatever the OS defaults to — the single loudest "nobody chose this" signal
 * an interface can send. Inter is what the products this one is measured
 * against (Linear, Figma, Vercel) actually run on, and next/font self-hosts
 * it at build time: no runtime fetch, no layout shift, no third-party request.
 *
 * Inter runs the INTERFACE — 13–15px labels in tables and config panels, where
 * the job of a typeface is to disappear.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

/**
 * …and Instrument Sans runs the three places that should NOT disappear: page
 * titles, the landing hero, and the metric numeral.
 *
 * A product set entirely in Inter is the house style of every dashboard built
 * since 2019 — legible, and indistinguishable. Instrument Sans is narrower and
 * has more tension in the letterforms, which gives a heading spine and gives
 * the tile's number the look of a figure on a statement rather than a large
 * label. It never appears below 17px, where its character would start costing
 * legibility and buy nothing.
 */
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
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
   * TWO COLOURS NOW, ONE PER THEME. A single `#ffffff` left the address bar
   * glowing white above a dark app — the one piece of chrome a dark theme
   * cannot fix from CSS, because the browser paints it from this tag.
   * Both are pinned to `--background` by tests/design-swatches.test.ts.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f5" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
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
    // `suppressHydrationWarning` is required, not defensive: next-themes stamps
    // the theme class onto <html> from a blocking script before React hydrates,
    // so this one element is knowingly different on the client. See theme.tsx.
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${instrument.variable}`}>
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
            appears after a beat is a control you have to hover twice. */}
        <ThemeProvider>
          <TooltipProvider>
            <AuthKitProvider initialAuth={initialAuth}>{children}</AuthKitProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
