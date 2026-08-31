import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { ArrowRight, Check } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * THE FRONT DOOR.
 *
 * This page was the one screen excluded from the kit — black buttons spelled by
 * hand while the kit's own primary went unused, raw neutrals, no focus states,
 * and a hero that was one sentence floating in about 600px of nothing. It was
 * also the first thing anybody ever saw.
 *
 * THE HERO IS THE THESIS, NOT A DESCRIPTION OF IT. The obvious move here is a
 * product screenshot or a big number under a gradient, and both are decoration:
 * they say "this is software" to someone who already assumed that. What this
 * product actually does is settle an argument — Calendly says 41 meetings,
 * Close says 38, the spreadsheet the team keeps by hand says 44, and somebody
 * has to walk into a Monday meeting with ONE figure and a reason to trust it.
 *
 * So the hero is that argument, rendered as the ledger the product produces:
 * the three sources disagreeing, the rule, and the resolved number with its
 * arithmetic shown underneath. It is the only element on the page allowed to
 * be loud, and everything around it is deliberately quiet — see the kit's
 * "quiet chrome, loud numbers" note in globals.css.
 *
 * Every connector named below is read from CONNECTOR_CATALOG rather than typed
 * out, so the marketing page cannot claim an integration the product does not
 * ship — the previous copy hard-coded four of the seven and had already fallen
 * behind.
 */
export const metadata = {
  title: "Namzilabs — one number, from every tool you already use",
  description:
    "Namzilabs reads Calendly, Close, Instantly, Google Sheets and more, reconciles the overlap between them, and gives you one figure you can defend — with the receipts for how it got there.",
};

/**
 * The hero ledger. Three sources, three answers, one resolution.
 *
 * The arithmetic is real and it adds up on purpose: 123 records arrive, 82 of
 * them are the same people seen twice, 41 remain. A demo whose numbers do not
 * reconcile is a demo of exactly the problem this product claims to fix.
 */
const LEDGER: Array<{ source: string; count: number; note: string }> = [
  { source: "Calendly", count: 41, note: "invitee-created events" },
  { source: "Close CRM", count: 38, note: "meetings logged to a lead" },
  { source: "Google Sheets", count: 44, note: "the sheet the team keeps by hand" },
];

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: "Connect your tools",
    body: "Sign in with Google, or paste an API key. New records start arriving within minutes and your history backfills behind you — you do not wait for it to finish before building anything.",
  },
  {
    title: "Build the metric",
    body: "Drag steps onto a canvas: pull records, keep the ones that count, match the same person across two sources, and total what is left. Test it against real rows before you publish it. No SQL, no warehouse.",
  },
  {
    title: "Watch it stay right",
    body: "A published metric recomputes on its own and shows its working: when it last ran, which sources it read, how many duplicates it matched, and what it left out and why.",
  },
];

export default async function Home() {
  const { user } = await withAuth();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <span className="font-display text-lg font-semibold text-foreground">Namzilabs</span>
        <nav className="flex items-center gap-1 sm:gap-2">
          {user ? (
            <Link className={cn(buttonVariants())} href="/dashboard">
              Go to dashboard
            </Link>
          ) : (
            <>
              <a className={cn(buttonVariants({ variant: "ghost" }))} href="/sign-in">
                Sign in
              </a>
              <a className={cn(buttonVariants())} href="/sign-up">
                Get started
              </a>
            </>
          )}
        </nav>
      </header>

      <main id="main" className="flex-1">
        {/* ---- Hero -------------------------------------------------------- */}
        <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-10 sm:px-8 sm:pb-24 sm:pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-16">
            <div>
              {/* THE MARKER, NOT THE BRAND. Coloured TEXT is a stroke, and the
                  brand's #eecf00 measures 1.42:1 on this ground — a caps
                  eyebrow set in it is a blank line with letter-spacing. Yellow
                  fills on this page (the buttons below); violet draws. */}
              <p className="text-xs font-semibold uppercase tracking-widest text-marker">
                For teams running on six tools
              </p>
              {/* `text-banner` is fluid — it resolves to 40px on a phone and
                  grows to 64px once there is room, so the headline is never a
                  four-line wall and never a timid line on a wide display. */}
              <h1 className="font-display mt-4 text-banner font-semibold text-foreground">
                One number,
                <br />
                and the receipts.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                Your tools each answer &ldquo;how many meetings did we book?&rdquo; differently, and none of them are
                lying. Namzilabs reads all of them, works out which records are the same person seen twice, and gives
                you one figure you can take into a Monday meeting.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <a className={cn(buttonVariants({ size: "lg" }), "gap-2")} href={user ? "/dashboard" : "/sign-up"}>
                  {user ? "Go to dashboard" : "Start free"}
                  <ArrowRight />
                </a>
                {!user && (
                  <a className={cn(buttonVariants({ variant: "secondary", size: "lg" }))} href="/sign-in">
                    Sign in
                  </a>
                )}
              </div>
              <p className="mt-5 text-xs text-muted-foreground">
                Read-only access. Disconnect any tool at any time and keep everything it already sent.
              </p>
            </div>

            {/* ---- The signature: the reconciliation ledger ---------------- */}
            <HeroLedger />
          </div>
        </section>

        {/* ---- What you connect -------------------------------------------- */}
        <section className="border-y border-border bg-neutral-50">
          <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              What you can connect today
            </h2>
            <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {CONNECTOR_CATALOG.map((entry) => (
                <li key={entry.source} className="border-t border-border pt-4">
                  <p className="text-md font-semibold text-foreground">{entry.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- How it works ------------------------------------------------ */}
        <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How it works</h2>
          {/* NUMBERED, because this genuinely is a sequence: you cannot build a
              metric before connecting a tool, and the order is the thing a
              first-time reader most needs. Numbering something that is not a
              sequence is decoration; this is not that. */}
          <ol className="mt-8 grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                {/* Violet again, and this one is worth stating: the brand sheet
                    draws its step numerals in yellow, but it draws them as
                    filled discs carrying near-black ink. This numeral is bare
                    glyph on the ground with nothing behind it, so it is a
                    stroke and it takes the marker. */}
                <span className="stat-numeral block text-display-xs leading-none text-marker">{i + 1}</span>
                <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">{step.title}</h3>
                {/* 16px, not the app's 14 — reading copy, not chrome. See the
                    note in ui/legal.tsx: `leading-relaxed` is the tell. */}
                <p className="mt-2 text-md leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---- Closing ----------------------------------------------------- */}
        <section className="border-t border-border bg-neutral-50">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 text-center sm:px-8 sm:py-20">
            <h2 className="font-display text-display-lg font-semibold text-foreground">Stop reconciling by hand.</h2>
            <p className="mx-auto mt-4 max-w-lg text-lg text-muted-foreground">
              Connect one tool and build your first metric in an afternoon.
            </p>
            <div className="mt-8 flex justify-center">
              <a className={cn(buttonVariants({ size: "lg" }), "gap-2")} href={user ? "/dashboard" : "/sign-up"}>
                {user ? "Go to dashboard" : "Start free"}
                <ArrowRight />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-sm text-muted-foreground sm:px-8">
          <span>&copy; {new Date().getFullYear()} Namzilabs</span>
          <nav className="flex gap-5">
            <Link className="inline-flex min-h-6 items-center rounded-control transition-colors hover:text-foreground" href="/terms">
              Terms
            </Link>
            <Link className="inline-flex min-h-6 items-center rounded-control transition-colors hover:text-foreground" href="/privacy">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/**
 * Three sources, three answers, one resolution — the product's whole claim in
 * one card.
 *
 * Presentational and static: it is a drawing of a real tile, not a live one,
 * and it says so by being on the marketing page rather than pretending to be
 * data. `aria-hidden` is deliberately NOT used — the numbers are the argument,
 * so they are read out; what IS hidden is the decorative rule between them.
 */
function HeroLedger() {
  return (
    <figure className="rounded-surface border border-border bg-card p-6 shadow-surface sm:p-7">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-md font-semibold text-foreground">Meetings booked</span>
        <span className="text-xs text-muted-foreground">Last 7 days</span>
      </figcaption>

      <ul className="mt-5 space-y-3">
        {LEDGER.map((row) => (
          <li key={row.source} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{row.source}</span>
              <span className="block truncate text-xs text-muted-foreground">{row.note}</span>
            </span>
            {/* The disagreeing numbers sit in muted ink: they are evidence,
                not the answer, and typesetting them as loudly as the result
                would be the card arguing with itself. */}
            <span className="tnum shrink-0 text-lg font-semibold text-muted-foreground">{row.count}</span>
          </li>
        ))}
      </ul>

      <div aria-hidden className="mt-5 border-t border-border" />

      <div className="mt-5 flex items-end justify-between gap-4">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Check aria-hidden className="size-4 shrink-0 text-success" />
            Namzilabs
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            123 records in · 82 matched as the same person · 41 unique
          </span>
        </span>
        <span className="stat-numeral shrink-0 text-display-md leading-none text-foreground">41</span>
      </div>
    </figure>
  );
}
