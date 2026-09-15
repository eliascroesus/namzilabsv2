import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { brandNeedsDarkInk, sourceStyle } from "@/components/flow/controls/source-style";
import { cn } from "@/lib/utils";

/**
 * THE TICKER OF TOOLS — this page's answer to the reference's logo wall.
 *
 * The reference runs ClickUp, Webflow, Typeform and Freshworks under the words
 * "Companies using Zapmail". We have no such list, and inventing one is the
 * single most tempting lie available to a landing page, so this row says a
 * different true thing in the same slot: these are the tools Namzilabs READS,
 * which is the question a visitor actually has at this point on the page.
 *
 * The wording carries the whole distinction and is deliberate: "Reads from",
 * never "Trusted by". Attio is not a customer, and a row of third-party marks
 * is read as an endorsement unless the label refuses that reading outright.
 *
 * EVERY NAME COMES FROM `CONNECTOR_CATALOG`, so this cannot claim an
 * integration the product does not ship. That is the same rule the page it
 * replaced followed, and it had already caught one drift: the copy before that
 * hard-coded four connectors and had fallen five behind.
 *
 * The chips are the connector's own brand colour and two-letter short, both
 * stored in the catalogue beside the connector — the marks belong to the
 * vendors, and `check-ui`'s hex rule names `catalog.ts` as the one sanctioned
 * place for them. No SVG logos: thirty-one of those is a `public/` directory,
 * a licence question per mark, and 200KB before anything renders.
 */

/** The track holds the list twice; the keyframe travels exactly half its width. */
const LOOP = [...CONNECTOR_CATALOG, ...CONNECTOR_CATALOG];

export function ToolMarquee() {
  return (
    /**
     * `aria-hidden`, because the row says everything TWICE — the duplicate
     * copy is what makes the loop seamless — and a screen reader walking the
     * hero would count sixty-two integrations. The accessible list is the
     * `#integrations` section below, which is the same array rendered once,
     * in a grid, with each connector's description.
     */
    <div aria-hidden className="marquee-track w-full overflow-hidden">
      <div className="marquee gap-2.5 py-1">
        {LOOP.map((entry, i) => {
          /* `brand` is OPTIONAL on a catalogue entry, and `sourceStyle` is the
             one place that already knows what an entry without one looks
             like — a neutral chip built from its key. Reading `entry.brand`
             directly here would be a second answer to that question, and the
             second answer is always the one that goes stale. */
          const brand = sourceStyle(entry.source);
          return (
          <span
            /* The second lap is the same connectors, so `source` alone is not
               unique — and duplicate keys in a list this long is React
               silently reusing the wrong node when anything re-renders. */
            key={`${entry.source}-${i}`}
            className="flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1.5 pl-1.5 pr-4"
          >
            <span
              /* Four of the thirty-one marks are yellow, where white initials
                 measure about 1.3:1 and the circle reads as empty. */
              className={cn(
                "stat-numeral flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                brandNeedsDarkInk(brand.color) ? "text-neutral-950" : "text-white",
              )}
              style={{ background: brand.color }}
            >
              {brand.short}
            </span>
            <span className="whitespace-nowrap text-sm font-medium text-white">{entry.name}</span>
          </span>
          );
        })}
      </div>
    </div>
  );
}
