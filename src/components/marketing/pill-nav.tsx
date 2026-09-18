import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";
import { BrandMark } from "@/components/marketing/brand-mark";
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
  /* FIVE, AND THE CUT IS DELIBERATE. Adding "Pricing" made six, and six
     wrapped the capsule onto two lines at 1440 — the nav is a fixed-width
     object and its content is not free. "The problem" and "Integrations" came
     off: the first is the argument's opening move and nobody arrives wanting
     to jump to it, and the second is answered by the marquee in the hero
     before anybody would think to look for it. */
  { href: "#how", label: "How it works" },
  { href: "#ai", label: "Ask your AI" },
  /* FAQ IS IN THE CAPSULE AND `#proof`/`#compare` ARE NOT, which is a choice
     rather than an oversight: those two are steps in the argument the page
     makes top to bottom, and nobody arrives wanting to jump to "the same
     question, two ways". The questions are the one section somebody navigates
     to DIRECTLY — it is where you go when you are most of the way to signing up
     and want to know what read access means. */
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

/**
 * THE CAPSULE'S ONE BUTTON, spelled once.
 *
 * INK ON WHITE, WHICH IS AN INVERSION OF WHAT IT WAS. The old capsule was a
 * 72%-black slab with a white button in it, because the sky underneath ran
 * from #1B3577 to #C0D5FF and a dark bar was the only thing legible over both
 * ends of it. The sky is DAYLIGHT now — pale blue, near-white at its foot — so
 * that slab became the heaviest object on the screen, sitting on top of the
 * lightest one.
 *
 * `--foreground` and `--background` rather than pinned neutrals, because the
 * new sky DOES follow the theme (see `.dark .day-sky`): dusk in the dark
 * theme, noon in the light one. The old comment's rule — "the sky does not
 * change with the theme, so neither may the control on it" — was true of the
 * old sky and is now exactly backwards.
 */
/**
 * INK ON WHITE, AND THIS IS THE THIRD TIME THIS BAR HAS FLIPPED.
 *
 * It is worth writing down why, because the answer is not indecision: this
 * capsule is STICKY, so it is the one object on the page that has to work over
 * every ground the page has, and the page's first ground has changed twice. It
 * was dark over a night sky and correct; it is light over a daylight cloud
 * photograph and correct again.
 *
 * WHAT MAKES THE LIGHT VERSION SAFE FOR THE WHOLE DOCUMENT: below the hero the
 * page is white or a pale band, so a white capsule with near-black links is at
 * full contrast for the entire scroll; the only two dark surfaces it crosses
 * are the assistant card and the closing card, and a bright bar over a deep
 * blue card is legible in the other direction. The dark version had the harder
 * job — it had to survive a near-white page — and it only ever managed it by
 * being 76% opaque.
 */
const WHITE_CTA = "gap-1.5 rounded-full border-transparent bg-neutral-950 text-white hover:bg-neutral-800";

/** The pill a nav link wears inside the capsule. */
const PILL =
  "inline-flex min-h-8 items-center whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium text-neutral-700 " +
  "transition-colors duration-(--duration-fast) hover:bg-neutral-950/6 hover:text-neutral-950 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

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
          "mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-2xl p-2 pl-4 sm:rounded-full sm:pl-5",
          // GLASS, NOT A SLAB. The reference floats a white translucent
          // capsule on its sky and it is the right answer here for a reason
          // the old dark bar could not use: a pale sky is close enough to
          // white that a 70%-white bar reads as the same material lit
          // differently, rather than as a panel laid over the top. The blur is
          // what sells it — the clouds smear behind the bar as they pass under
          // it, which a flat fill cannot fake.
          // WHITE GLASS. See the note beside WHITE_CTA: the bar is sticky, the
          // page under it is light for all but two cards, and the sky it
          // starts on is a bright photograph. 88% white rather than a true
          // glass pane because the clouds behind it have real contrast in
          // them — at 55% the nav links sat on whatever cloud happened to be
          // passing, which is a contrast that changes as you scroll.
          "border border-white/80 bg-white/88 backdrop-blur-md",
        )}
      >
        <Link
          href="/"
          className="font-marketing flex shrink-0 items-center gap-2 rounded-control text-lg font-bold tracking-tight text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <BrandMark className="size-6 shrink-0" />
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
              {/* INK, NOT THE BRAND FILL — see WHITE_CTA above. On the pale
                  sky the near-black pill is the highest-contrast object
                  available, which is what the page's one action should be, and
                  it matches the two CTAs in the body rather than introducing a
                  third button colour. */}
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
              className="flex size-9 cursor-pointer list-none items-center justify-center rounded-full text-neutral-700 transition-colors duration-(--duration-fast) hover:bg-neutral-950/6 hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
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
