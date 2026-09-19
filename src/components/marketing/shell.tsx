import { cn } from "@/lib/utils";

/**
 * THE SPINE.
 *
 * One 1240px column, one set of gutters, one section rhythm — 140px of air on
 * Paper, 180px on a full-bleed block. Owned here so no section can invent its
 * own spacing, which is how a page ends up with four different section heights
 * nobody chose.
 *
 * FULL-BLEED MEANS THE GROUND, NOT THE CONTENT. A Night or Blue block runs
 * edge to edge, but what sits inside it stays on the same 1240px column as
 * everything else. That is the difference between a tonal break that belongs
 * to the page and one that reads as an interruption in it.
 */
export function SectionShell({
  id,
  label,
  title,
  standfirst,
  tone = "paper",
  children,
  className,
  headClassName,
}: {
  id?: string;
  label: string;
  title: React.ReactNode;
  standfirst?: string;
  tone?: "paper" | "night" | "blue";
  children?: React.ReactNode;
  className?: string;
  headClassName?: string;
}) {
  const bleed = tone !== "paper";
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20",
        bleed ? "sec-bleed" : "sec",
        tone === "night" && "block-night",
        tone === "blue" && "block-blue",
        className,
      )}
    >
      <div className="lander-col">
        <div className={cn("max-w-[52rem]", headClassName)}>
          {/* Small, sentence case, blue. Never tracked-out capitals — that is
              the commonest tell of a page nobody art-directed. */}
          <p className="t-label">{label}</p>
          <h2 className="t-sec mt-4">{title}</h2>
          {standfirst && <p className="t-stand mt-6">{standfirst}</p>}
        </div>

        {children && <div className="mt-16 lg:mt-24">{children}</div>}
      </div>
    </section>
  );
}

/**
 * THE SCREENSHOT TREATMENT — a Haze panel with the product oversized inside it,
 * running off one edge, and the page's only shadow underneath.
 *
 * THE BLEED IS THE WHOLE IDEA. A picture that fits neatly inside its frame
 * reads as an illustration OF the product; one that runs past the frame reads
 * as a window ONTO it, and the page is simply too small to hold the thing.
 * Stripe and Lovable both crop this way and it is most of why their product
 * shots look like software rather than like marketing.
 *
 * It also buys legibility, which is the real complaint the old page had: a
 * whole dashboard at 50% inside a column is a picture of a dashboard with
 * nothing readable in it.
 */
export function HazeShot({
  children,
  hero = false,
  className,
}: {
  children: React.ReactNode;
  /** The hero's panel crops from the FOOT rather than the side. */
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("haze", hero && "haze-hero", className)}>
      <div className="haze-shot">{children}</div>
    </div>
  );
}
