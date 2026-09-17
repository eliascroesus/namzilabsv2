import { cn } from "@/lib/utils";

/**
 * THE FEATURE ROW — words on one side, a picture of the product on the other,
 * and the picture runs off the edge of the page.
 *
 * WHAT THIS REPLACES. The previous version of this page put its three steps in
 * three equal cards side by side: same width, same radius, same border,
 * pictures shrunk to fit a third of the container. Three of anything in a row
 * is the safest layout there is and it is also the most anonymous — it says
 * nothing about which of the three matters, and at a third of 1152px no
 * screenshot is legible enough to be worth including.
 *
 * THE BLEED IS THE WHOLE IDEA, and it is the reference's signature move
 * (themochi.app puts its inbox shot half off the right edge). A picture that
 * fits neatly inside a column reads as an illustration OF the product; one
 * that runs past the margin reads as a window ONTO it — the page is too small
 * to hold the thing, so you are seeing part of it. It also buys real estate: at
 * 150% of its column the screenshot is legible instead of decorative.
 *
 * WHICH SIDE IT BLEEDS TO ALTERNATES, because a page of rows that all bleed
 * right develops a diagonal drift and the eye stops returning to the left
 * margin.
 */
export function FeatureRow({
  label,
  title,
  body,
  accent,
  side = "right",
  children,
}: {
  label: string;
  title: React.ReactNode;
  body: string;
  /**
   * ONE SENTENCE IN BRAND INK, carried separately rather than spliced into
   * `body` as markup.
   *
   * The reference highlights a clause in purple in every feature paragraph,
   * and it works because it is the sentence that says what CHANGES for you —
   * the rest is mechanism. Making it a named field rather than a `<span>` in a
   * string means it cannot quietly become "whichever words looked good in
   * colour", which is how an accent turns into decoration.
   */
  accent: string;
  side?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid items-center gap-10 lg:grid-cols-2 lg:gap-16",
        /* The picture is FIRST in the DOM on a left-bleeding row and second on
           a right-bleeding one, so reading order follows the visual order at
           every width instead of only at `lg`. `order-*` would have kept the
           markup tidy and handed a screen reader the pictures before the
           words. */
        side === "left" && "lg:[&>*:first-child]:order-2",
      )}
    >
      <div className="max-w-xl">
        {/* SENTENCE CASE, NOT A TRACKED-OUT CAPITALISED EYEBROW. The page had
            five of those and they are the commonest tell of a layout nobody
            art-directed. The reference labels its sections "Organized Inbox
            Tab" — plain words, normal case, doing the same job quietly. */}
        <p className="text-sm font-medium text-brand-800">{label}</p>

        <h3 className="font-marketing mt-3 text-display-lg font-bold leading-[1.08] tracking-tight text-foreground">
          {title}
        </h3>

        <p className="mt-5 text-md leading-relaxed text-muted-foreground">
          {body} <span className="font-medium text-brand-800">{accent}</span>
        </p>
      </div>

      {/* ── the window ──────────────────────────────────────────────────── */}
      {/* `min-w-0` on the track and a wider child inside it: the bleed is done
          by letting the frame exceed its own grid column, which only works if
          the column is allowed to be narrower than its content. Without it the
          grid grows to fit and the row silently stops bleeding — correct in
          the source, absent in the browser. */}
      <div className="relative min-w-0">
        <div
          className={cn(
            "lift-lg relative overflow-hidden rounded-3xl border border-border bg-background p-2 sm:p-2.5",
            /* 142% of the column, pushed past the margin on its own side, and
               the section above clips it at the viewport rather than at the
               container — so the shot leaves the page instead of stopping in
               a stripe of white.

               Below `lg` it sits square in the flow: a shot that bleeds off a
               390px phone is a shot with a third of it permanently off
               screen. */
            side === "right" ? "lg:ml-0 lg:w-[142%]" : "lg:-ml-[42%] lg:w-[142%]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
