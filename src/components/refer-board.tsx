import { Check, Lock, Sparkles, Zap } from "lucide-react";
import { CopyField } from "@/components/copy-field";
import { InviteButton } from "@/components/invite-picker";
import { MILESTONES, progressFor } from "@/lib/referral";
import { cn } from "@/lib/utils";

/**
 * THE INVITE BOARD — one component, two routes.
 *
 * It lives here rather than inside the page because `/dashboard/refer` is
 * behind WorkOS: with the markup in the page, the only thing a public check
 * could drive was a hand-built miniature on `/design/refer`, and a fixture that
 * is not the thing is how a page passes every check and still looks wrong.
 * Both routes render THIS, so `pnpm refer` measures the real board.
 *
 * WHY IT IS A DARK BRAND CARD. The first version was a pale `--brand-soft` wash
 * carrying a pale trough, and the report was "where is the progress bar" —
 * which was not a taste problem: the trough was `--background` on a 10% brand
 * tint, about 1.1:1 apart, and at zero invites the fill had no width at all. So
 * the one object the page exists for was a pale rectangle on a pale rectangle
 * containing nothing.
 *
 * The sky fixes it by changing what the bar sits ON. White on `.sky-card`'s
 * deep blue is the highest-contrast pairing in the product, it is the surface
 * the landing page uses for its one loud moment, and it does not follow the
 * theme — so this card looks the same to everybody and cannot be washed out by
 * a light palette.
 *
 * NO PROSE ANYWHERE ON IT. Every explanatory sentence came off at the owner's
 * ask, which is the same rule already applied to the tile settings and the flow
 * builder's field picker: descriptions go behind an ⓘ, and what is left on the
 * surface is the thing itself. What that costs is spelled out at the ⓘ in
 * `refer/page.tsx` — the caveats are real and are still one hover away, not
 * gone.
 */
export function ReferBoard({ link, code, count }: { link: string; code: string; count: number }) {
  const p = progressFor(count);

  return (
    <>
      {/* ── THE SCOREBOARD ───────────────────────────────────────────────── */}
      <div className="sky-card mt-4 overflow-hidden rounded-frame p-6 sm:rounded-3xl sm:p-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/80">
              <Sparkles aria-hidden className="size-3.5" />
              {p.earned ? `${p.earned.reward} unlocked` : "Invite & earn"}
            </p>

            {/* THE COUNT IS THE PAGE. `text-banner` is the landing page's one
                oversized step and this is the only place in the app that
                borrows it, because this is the only number in the product whose
                whole job is to make somebody want it to be bigger. */}
            <p className="mt-4 flex items-baseline gap-4">
              <span className="stat-numeral text-banner leading-none text-white">{count}</span>
              <span className="text-lg text-white/80">{count === 1 ? "person joined" : "people joined"}</span>
            </p>

            <p className="mt-3 text-lg leading-snug text-white/85">
              {p.next ? (
                <>
                  <span className="font-semibold text-white">{p.toGo} more</span> unlocks{" "}
                  <span className="font-semibold text-white">{p.next.reward}</span>
                </>
              ) : (
                <span className="font-semibold text-white">Every reward unlocked</span>
              )}
            </p>
          </div>

          {/* WHITE, NOT THE BRAND FILL — the same call the landing page's CTA
              makes, and for the same reason: a #568CFF button on a deep blue
              ground is a shape you have to hunt for. */}
          <InviteButton
            link={link}
            className="shrink-0 border-transparent bg-white text-neutral-950 hover:bg-brand-50"
          />
        </div>

        {/* ── THE TRACK ────────────────────────────────────────────────────
            Every rung gets an EQUAL fifth of the width. To scale, 1/3/5/10/25
            would crowd the first four into the left sixth and give the run to
            25 two-thirds of the bar — the early wins that matter most would be
            invisible and the end would look impossible. */}
        <div className="mt-10">
          <div
            data-refer-track
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={p.ladderPercent}
            aria-label={p.next ? `${p.toGo} more invites until ${p.next.reward}` : "Every reward unlocked"}
            className="relative h-4 w-full rounded-full bg-neutral-950/35"
          >
            <div
              data-refer-fill
              className="h-full rounded-full bg-white transition-[width] duration-(--duration-slow) ease-(--ease-standard)"
              style={{ width: `${p.ladderPercent}%` }}
            />

            {/* THE RUNGS, ON THE BAR ITSELF. A bar plus a list of milestones
                somewhere else is two things to read and a mapping to work out
                between them. One object with the prizes pinned to it is a
                track, and a track is the thing people watch. */}
            {MILESTONES.map((m, i) => {
              const at = ((i + 1) / MILESTONES.length) * 100;
              const done = count >= m.at;
              return (
                <span
                  key={m.at}
                  data-refer-pip={m.at}
                  style={{ left: `${at}%` }}
                  className={cn(
                    "absolute top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 transition-colors",
                    done ? "border-white bg-white text-neutral-950" : "border-white/40 bg-neutral-950/60 text-white/70",
                  )}
                >
                  {done ? (
                    <Check aria-hidden className="size-3.5" />
                  ) : (
                    <span className="stat-numeral text-xs leading-none">{m.at}</span>
                  )}
                </span>
              );
            })}
          </div>

          {/* The prize under each pip, so the track reads left to right as one
              sentence: this many people, this reward.

              THE COLUMN COUNT IS DERIVED, not written. It was `grid-cols-5`
              beside a five-rung ladder, and the day a rung came off — the
              lifetime tier, withdrawn at the owner's ask — the labels would
              have stayed on a five-column grid under four pips, each one
              a fifth of the way out of line with the pip above it. A ladder
              that can be edited in one array has to be laid out from that
              array's length. */}
          <div
            className="mt-4 grid gap-1 text-center"
            style={{ gridTemplateColumns: `repeat(${MILESTONES.length}, minmax(0, 1fr))` }}
          >
            {MILESTONES.map((m) => (
              <span
                key={m.at}
                className={cn(
                  "truncate text-xs font-medium",
                  count >= m.at || p.next?.at === m.at ? "text-white" : "text-white/55",
                )}
              >
                {p.next?.at === m.at && <Zap aria-hidden className="mr-1 inline-block size-3 align-[-1px]" />}
                {m.reward}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── THE RUNGS AS CARDS ──────────────────────────────────────────────
          The reward is the HEADLINE and the count is the caption, which is the
          way round somebody reads them: you are shopping for the prize and then
          asking what it costs. The blurb under each one is gone. */}
      {/* FLEX-WRAP, NOT A COLUMN COUNT. `lg:grid-cols-5` beside a five-rung
          ladder is a number that has to be edited in two places, and the day
          the lifetime tier came off it would have left a fifth empty cell. A
          row of cards with a minimum width lays itself out for any ladder. */}
      <ul className="mt-6 flex flex-wrap gap-3">
        {MILESTONES.map((m) => {
          const done = count >= m.at;
          const current = p.next?.at === m.at;
          return (
            <li
              key={m.at}
              className={cn(
                "flex min-w-[13rem] flex-1 flex-col gap-3 rounded-card border p-4 transition-colors",
                done
                  ? "border-success/40 bg-success-soft"
                  : current
                    ? "border-brand-soft-line bg-brand-soft"
                    : "border-border bg-card",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="stat-numeral text-sm text-muted-foreground">
                  {m.at} {m.at === 1 ? "invite" : "invites"}
                </span>
                {done ? (
                  <Check aria-hidden className="size-4 shrink-0 text-success" />
                ) : current ? (
                  <span className="stat-numeral shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                    {p.toGo} to go
                  </span>
                ) : (
                  <Lock aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                )}
              </span>
              <span className="text-md font-semibold leading-snug text-foreground">{m.reward}</span>
            </li>
          );
        })}
      </ul>

      {/* ── THE LINK ────────────────────────────────────────────────────── */}
      <div className="mt-6 max-w-xl">
        <CopyField label="Your link" value={link} isUrl hint={`Code ${code}`} />
      </div>
    </>
  );
}
