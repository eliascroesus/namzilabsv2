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
    features: ["Up to 5 tools connected", "1 seat"],
  },
  {
    name: "Team",
    monthly: 149,
    popular: true,
    blurb: "For a team that has to agree on one number before Monday.",
    features: [
      "Up to 20 tools connected",
      "10 seats",
      "Shared boards and saved views",
      "Claude and ChatGPT over MCP",
    ],
  },
  {
    name: "Business",
    monthly: 399,
    blurb: "For everybody who needs the same figure at the same time.",
    features: [
      "Every connector, no cap",
      "Unlimited seats",
      "Roles and per-person permissions",
      "Claude and ChatGPT over MCP",
    ],
  },
];

/**
 * THE THREE THINGS EVERY PLAN GETS, lifted out of the columns.
 *
 * They used to take a line in each of the three, which is three-quarters of
 * what a reader was scanning for differences in — and "full receipts on every
 * figure" appeared on SOLO ONLY, which read as though the paid tiers lose the
 * product's best feature. Stating them once above the table leaves the columns
 * holding nothing but what actually differs.
 */
const UNIVERSAL = "Every plan: unlimited metrics and boards, recomputed every ten minutes, full receipts on every figure.";

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
        className="pricing-toggle"
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
              yearly === opt.on ? "pricing-toggle-on" : "pricing-toggle-off",
            )}
          >
            {opt.label}
            {opt.on && (
              <span className="pricing-save">−{Math.round(YEARLY_OFF * 100)}%</span>
            )}
          </button>
        ))}
      </div>

      <p className="pricing-universal">{UNIVERSAL}</p>

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
                "pricing-col",
                /* THREE IDENTICAL CARDS WAS THE OLD ANSWER AND IT SAID NOTHING.
                   Solo and Business are plain columns now, separated by
                   hairlines — furniture, not objects. Team is the one panel:
                   inverted, the same ink as the full-bleed sections, so the
                   recommendation is legible from across the room instead of
                   being announced by a 26px pill. */
                tier.popular && "pricing-col-featured ink-block",
              )}
            >
              {/* `min-h-8` SO THE THREE PRICE ROWS SIT ON A LINE. Only the
                  middle card carries a badge, and a 26px pill in a row sized
                  by a 28px heading made that one header two pixels taller than
                  its neighbours — which pushed its price, its button and every
                  feature under it out of alignment with the other two. */}
              <div className="flex min-h-8 items-center justify-between gap-3">
                <h3 className="font-marketing text-xl font-bold tracking-tight" style={{ color: "var(--ink)" }}>{tier.name}</h3>
                {tier.popular && (
                  <span className="pricing-badge">Most popular</span>
                )}
              </div>

              <p className="mt-2 min-h-10 text-sm leading-relaxed" style={{ color: "var(--ink-muted)" }}>{tier.blurb}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                {/* NOT MONO. Mono on this page means "a machine computed
                    this and you can check it"; a price is a number a person
                    chose. Using it here would empty the rule of meaning. */}
                <span className="font-marketing text-display-md font-bold leading-none tracking-tight" style={{ color: "var(--ink)" }}>
                  ${price}
                </span>
                <span className="text-sm" style={{ color: "var(--ink-muted)" }}>/ month</span>
              </p>
              {/* The line is always present, so the cards do not change height
                  when the toggle moves — a 20px reflow across three cards is
                  the tell that a toggle is doing more than it should. */}
              <p className="mt-1.5 min-h-5 text-xs" style={{ color: "var(--ink-muted)" }}>
                {yearly ? `Billed yearly — $${price * 12}` : "Billed monthly"}
              </p>

              <a
                href={cta}
                className={cn("mt-7 w-full", tier.popular ? "btn-solid-invert" : "btn-ghost")}
              >
                Start free
              </a>

              {/* ONLY WHAT DIFFERS. The three facts true of every plan moved
                  above the table, so a reader comparing columns is comparing
                  the jump rather than re-reading the same three lines. */}
              <ul className="mt-7 flex flex-col gap-3 pt-6" style={{ borderTop: "1px solid var(--rule)" }}>
                {tier.features.map((f) => (
                  <li key={f} className="flex min-w-0 items-start gap-2.5">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0" style={{ color: "var(--ink-muted)" }} />
                    <span className="min-w-0 text-sm leading-relaxed" style={{ color: "var(--ink)" }}>
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
        Every plan starts with a 14-day trial. No card up front, and read-only access throughout.
      </p>
    </div>
  );
}
