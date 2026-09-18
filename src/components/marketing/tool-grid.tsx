import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";
import { PauseOffscreen } from "@/components/marketing/pause-offscreen";

/**
 * EVERY TOOL IT READS, AS TWO ROWS RUNNING IN OPPOSITE DIRECTIONS.
 *
 * ── WHAT THIS REPLACES, TWICE ──────────────────────────────────────────────
 *
 * First it was 42 rows of name-plus-description in three columns: about 900px
 * of uninterrupted 14px grey, and the least-looked-at block on the page.
 *
 * Then it was a static 4x8 grid of logo tiles, which was better and still
 * inert — thirty-two identical rectangles sitting perfectly still, which is a
 * fair description of the whole page at that point.
 *
 * ── WHY MOTION IS THE RIGHT ANSWER SPECIFICALLY HERE ───────────────────────
 *
 * The question this section answers is "do you read MY stack", and that is
 * answered by recognition — you are scanning for one logo, not reading a list.
 * A moving row is scanned rather than read, which is what you want people
 * doing; and thirty-two tools going past in both directions communicates
 * ABUNDANCE in a way a tidy grid actively works against. A grid says "here are
 * thirty-two things". Two rows sliding past each other say "there are a lot of
 * these".
 *
 * OPPOSITE DIRECTIONS because two rows travelling the same way read as one
 * block sliding, and the parallax between them is what makes it feel like
 * depth rather than a conveyor.
 *
 * SPLIT IN HALF, NOT DUPLICATED, so no tool appears in both rows — a logo
 * passing twice in opposite directions is the tell that it is a loop rather
 * than a catalogue.
 */
const HALF = Math.ceil(CONNECTOR_CATALOG.length / 2);
const ROWS = [CONNECTOR_CATALOG.slice(0, HALF), CONNECTOR_CATALOG.slice(HALF)];

function Row({ entries, reverse }: { entries: typeof CONNECTOR_CATALOG; reverse?: boolean }) {
  /* Doubled so the loop has somewhere to travel to: the animation runs to
     -50%, at which point the second copy sits exactly where the first began. */
  const loop = [...entries, ...entries];
  return (
    <div className="marquee-track w-full overflow-hidden">
      <div className={`marquee gap-3 py-1.5 ${reverse ? "marquee-reverse" : ""}`}>
        {loop.map((entry, i) => (
          <span
            /* The index is in the key because a doubled list has duplicate
               sources, and duplicate keys are React silently reusing the wrong
               node on any re-render. */
            key={`${entry.source}-${i}`}
            title={entry.description}
            className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3"
          >
            <SourceMark source={entry.source} size={28} className="stat-numeral shrink-0" />
            <span className="whitespace-nowrap text-sm font-medium text-foreground">{entry.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ToolGrid() {
  return (
    /* PAUSED WHEN IT IS NOT ON SCREEN. Two rows of 64 chips animating forever
       while somebody reads the FAQ two thousand pixels below is exactly the
       kind of always-on compositing the scroll pass took off the hero. */
    <PauseOffscreen>
      <div className="flex flex-col gap-3">
        {ROWS.map((entries, i) => (
          <Row key={i} entries={entries} reverse={i === 1} />
        ))}
      </div>
    </PauseOffscreen>
  );
}
