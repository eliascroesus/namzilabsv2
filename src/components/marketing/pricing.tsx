"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE NUMBERS BELOW ARE A PROPOSAL AND HAVE NOT BEEN APPROVED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The owner asked for a pricing section and did not give prices. Everything in
 * `TIERS` — the three names, the three figures, the seat and tool limits, and
 * which line items sit in which tier — was chosen HERE, by reading what the
 * product actually does, and it is a commercial decision rather than a design
 * one. A price on a landing page is an offer somebody can hold you to.
 *
 * WHAT WAS USED TO PICK THEM, so they can be argued with rather than just
 * replaced: the product's cost driver is connector sweeps against other
 * people's APIs plus the Neon egress those writes cause, both of which scale
 * with TOOLS CONNECTED far more than with seats. So the ladder is priced on
 * tools and the seat counts are generous — the opposite of the usual per-seat
 * shape, and the honest one for this product.
 *
 * EDITING THIS IS A ONE-PLACE CHANGE. The card grid, the toggle, the "most
 * popular" ring and the yearly arithmetic all derive from this array; nothing
 * downstream hard-codes a number or a tier count.
 *
 * `YEARLY_OFF` is applied as a real discount to a real monthly figure rather
 * than being a second set of typed-in numbers, so the two can never disagree.
 */
const YEARLY_OFF = 0.2;

const TIERS: Array<{
  name: string;
  monthly: number;
  blurb: string;
  features: string[];
  popular?: boolean;
}> = [
  {
    name: "Solo",
    monthly: 49,
    blurb: "For one person with an audience and more tools than time.",
    features: [
      "Up to 5 tools connected",
      "Unlimited metrics and boards",
      "10-minute recompute",
      "Full receipts on every figure",
      "1 seat",
    ],
  },
  {
    name: "Team",
    monthly: 149,
    popular: true,
    blurb: "For a team that has to agree on one number before Monday.",
    features: [
      "Up to 20 tools connected",
      "Unlimited metrics and boards",
      "10-minute recompute",
      "Shared boards and saved views",
      "Claude and ChatGPT over MCP",
      "10 seats",
    ],
  },
  {
    name: "Business",
    monthly: 399,
    blurb: "For everybody who needs the same figure at the same time.",
    features: [
      "Every connector, no cap",
      "Unlimited metrics and boards",
      "10-minute recompute",
      "Roles and per-person permissions",
      "Claude and ChatGPT over MCP",
      "Unlimited seats",
    ],
  },
];

export function Pricing({ cta }: { cta: string }) {
  const [yearly, setYearly] = useState(false);

  return (
    <div className="flex flex-col items-center gap-10">
      {/* ── the toggle ──────────────────────────────────────────────────── */}
      {/* TWO BUTTONS IN A TRACK, not a switch. A switch is for a setting that
          is on or off; this is a choice between two named things, and the
          reference draws it the same way. Both labels stay readable at all
          times, which a switch's off-state label never is. */}
      <div
        role="group"
        aria-label="Billing period"
        className="flex items-center gap-1 rounded-full border border-border bg-card p-1"
      >
        {[
          { on: false, label: "Monthly" },
          { on: true, label: "Yearly" },
        ].map((opt) => (
          <button
            key={opt.label}
            type="button"
            aria-pressed={yearly === opt.on}
            onClick={() => setYearly(opt.on)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-(--duration-fast)",
              yearly === opt.on
                ? "lift-sm bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.on && (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand-800">
                −{Math.round(YEARLY_OFF * 100)}%
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── the cards ───────────────────────────────────────────────────── */}
      <div className="grid w-full gap-5 lg:grid-cols-3">
        {TIERS.map((tier) => {
          /* Rounded to the pound. A yearly price of £119.20 is arithmetic
             showing through the design; the discount is a marketing number and
             should read as one. */
          const price = yearly ? Math.round(tier.monthly * (1 - YEARLY_OFF)) : tier.monthly;

          return (
            <div
              key={tier.name}
              className={cn(
                "flex flex-col rounded-3xl border p-7 sm:p-8",
                /* THE POPULAR TIER IS RAISED, NOT RECOLOURED. A brand-filled
                   card would make the other two read as disabled; a ring and a
                   shadow say "start here" without saying "not those". */
                tier.popular
                  ? "lift-lg border-brand-400 bg-card ring-1 ring-brand-400"
                  : "lift-sm border-border bg-card",
              )}
            >
              {/* `min-h-8` SO THE THREE PRICE ROWS SIT ON A LINE. Only the
                  middle card carries a badge, and a 26px pill in a row sized
                  by a 28px heading made that one header two pixels taller than
                  its neighbours — which pushed its price, its button and every
                  feature under it out of alignment with the other two. */}
              <div className="flex min-h-8 items-center justify-between gap-3">
                <h3 className="font-marketing text-xl font-bold tracking-tight text-foreground">{tier.name}</h3>
                {tier.popular && (
                  <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-800">
                    Most popular
                  </span>
                )}
              </div>

              <p className="mt-2 min-h-10 text-sm leading-relaxed text-muted-foreground">{tier.blurb}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="font-marketing text-display-md font-bold leading-none tracking-tight text-foreground">
                  ${price}
                </span>
                <span className="text-sm text-muted-foreground">/ month</span>
              </p>
              {/* The line is always present, so the cards do not change height
                  when the toggle moves — a 20px reflow across three cards is
                  the tell that a toggle is doing more than it should. */}
              <p className="mt-1.5 min-h-5 text-xs text-muted-foreground">
                {yearly ? `Billed yearly — $${price * 12}` : "Billed monthly"}
              </p>

              <a
                href={cta}
                className={cn(
                  "mt-7 flex h-11 items-center justify-center rounded-full text-button font-semibold transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  tier.popular
                    ? "bg-foreground text-background hover:bg-foreground/90"
                    : "border border-border text-foreground hover:bg-accent",
                )}
              >
                Start free
              </a>

              <ul className="mt-7 flex flex-col gap-3 border-t border-border pt-6">
                {tier.features.map((f) => (
                  <li key={f} className="flex min-w-0 items-start gap-2.5">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                    <span className="min-w-0 text-sm leading-relaxed text-foreground">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">
        Every plan starts with a 14-day trial. No card up front, and read-only access throughout.
      </p>
    </div>
  );
}
