import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE FLOATING PILL BAR.
 *
 * A capsule that hovers over the hero rather than a rule ruling off the top of
 * it — the shape the reference uses, and the right one HERE for a reason the
 * reference does not have: this page's hero is a full-bleed gradient, and a
 * conventional bar would cut a straight grey line across the one image on the
 * site. A capsule sits ON the sky and lets it run underneath.
 *
 * IT CARRIES NO JAVASCRIPT, which is the whole design of the mobile half.
 * A hamburger is two states and a listener, and every version of that in this
 * repo is a client component; `<details>` is the same two states in the
 * platform, open before hydration and correct with JS switched off. `<summary>`
 * is also not a `<button>`, so the kit's hand-rolled-button rule — which is
 * right to refuse a bare `<button>` on an ordinary page — has nothing to
 * object to, and no exemption had to be written for a marketing page.
 *
 * WHY THE LINKS ARE NOT `Button`s. They are links: they navigate. `buttonVariants`
 * would give them the kit's control height and a variant built for a form, and
 * the capsule wants a 34px pill on a translucent ground that exists nowhere
 * else in the product. The ONE control that acts like a button — "Get started"
 * — is a `buttonVariants` link, so the page's primary action is the kit's.
 */

/** Same list twice — once in the capsule, once in the sheet — so it lives once. */
const LINKS: Array<{ href: string; label: string }> = [
  { href: "#problem", label: "The problem" },
  { href: "#how", label: "How it works" },
  { href: "#ai", label: "Ask your AI" },
  { href: "#integrations", label: "Integrations" },
  /* FAQ IS IN THE CAPSULE AND `#proof`/`#compare` ARE NOT, which is a choice
     rather than an oversight: those two are steps in the argument the page
     makes top to bottom, and nobody arrives wanting to jump to "the same
     question, two ways". The questions are the one section somebody navigates
     to DIRECTLY — it is where you go when you are most of the way to signing up
     and want to know what read access means. */
  { href: "#faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

/**
 * THE CAPSULE'S ONE BUTTON, spelled once.
 *
 * WHITE, NOT THE BRAND FILL, and not the kit's `white` variant either. The
 * capsule sits on brand blue for the whole hero, so a #568CFF button on a
 * #3462CF ground is a shape you have to hunt for; and `variant="white"` is
 * `bg-secondary`, which follows the THEME — on a dark-mode visitor's machine
 * it renders a near-black button on a near-black capsule. The hero's sky does
 * not change with the theme, so neither may the control sitting on it.
 */
const WHITE_CTA = "gap-1.5 rounded-full border-transparent bg-white text-neutral-950 hover:bg-brand-50";

/** The pill a nav link wears inside the capsule. */
const PILL =
  "inline-flex min-h-8 items-center rounded-full px-4 py-1.5 text-sm font-medium text-white/80 " +
  "transition-colors duration-(--duration-fast) hover:bg-white/15 hover:text-white " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export function PillNav({ signedIn }: { signedIn: boolean }) {
  return (
    /**
     * STICKY AND ZERO-HEIGHT, which is the whole trick and worth spelling out.
     *
     * The capsule has to float ON the sky — the hero's gradient must run
     * underneath it to the very top of the page — and it has to stay put while
     * the page scrolls. `fixed` gives the second and not the first: the hero
     * would have to reserve 80px of padding that the sky does not fill, and
     * every in-page anchor would land 80px under the bar.
     *
     * A `sticky` wrapper of height ZERO gives both. It takes no space in the
     * flow, so the hero starts at y=0 and the sky is genuinely behind the
     * capsule; the nav inside it overflows downward and paints normally; and
     * sticky positioning still pins it for the whole document rather than
     * only for its own section, which is what would happen if the capsule
     * lived inside the hero. `scroll-mt-28` on the anchored sections below
     * pays for the overlap that remains.
     */
    <div className="sticky top-0 z-50 h-0 w-full">
      {/* The inset lives on the INNER box. `h-0` zeroes the content box only —
          padding on the sticky wrapper still occupies 12px of the document,
          which put a white strip above the sky and started the hero at y=16. */}
      <div className="px-3 pt-3 sm:px-5 sm:pt-4">
      <nav
        aria-label="Main"
        className={cn(
          "mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-frame p-2 pl-4 sm:rounded-full sm:pl-5",
          // A dark capsule rather than a translucent one: the sky underneath
          // runs from #1B3577 to #C0D5FF, and a bar that borrows its ground
          // would be legible at the top of the page and invisible at the
          // bottom of it. The blur is what keeps it from reading as a slab.
          "border border-white/10 bg-[color-mix(in_oklab,var(--color-neutral-950)_72%,transparent)] shadow-lifted backdrop-blur-md",
        )}
      >
        <Link
          href="/"
          className="font-display shrink-0 rounded-control text-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
        >
          Namzilabs
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={PILL}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {signedIn ? (
            <a className={cn(buttonVariants({ variant: "secondary" }), WHITE_CTA)} href="/dashboard">
              Dashboard
              <ArrowUpRight className="size-4" aria-hidden />
            </a>
          ) : (
            <>
              <a className={cn(PILL, "hidden sm:inline-flex")} href="/sign-in">
                Sign in
              </a>
              {/* WHITE, NOT THE BRAND FILL. The capsule sits on brand blue for
                  the whole hero, and a #568CFF button on a #3462CF ground is a
                  shape you have to hunt for. White is the only fill with a
                  guaranteed contrast against every stop of that gradient. */}
              <a className={cn(buttonVariants({ variant: "secondary" }), WHITE_CTA)} href="/sign-up">
                Get started
                <ArrowUpRight className="size-4" aria-hidden />
              </a>
            </>
          )}

          {/* --- The mobile sheet, in two platform elements ----------------- */}
          <details className="group relative md:hidden">
            <summary
              aria-label="Open the menu"
              className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full text-white/80 transition-colors duration-(--duration-fast) hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white [&::-webkit-details-marker]:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </summary>
            <div className="absolute right-0 top-full z-50 mt-3 w-56 overflow-hidden rounded-card border border-border bg-popover p-1.5 shadow-pop">
              {LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="block rounded-control px-3 py-2.5 text-sm font-medium text-popover-foreground transition-colors duration-(--duration-fast) hover:bg-accent"
                >
                  {l.label}
                </Link>
              ))}
              {!signedIn && (
                <a
                  className="block rounded-control px-3 py-2.5 text-sm font-medium text-popover-foreground transition-colors duration-(--duration-fast) hover:bg-accent sm:hidden"
                  href="/sign-in"
                >
                  Sign in
                </a>
              )}
            </div>
          </details>
        </div>
      </nav>
      </div>
    </div>
  );
}
