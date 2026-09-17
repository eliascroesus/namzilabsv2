import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";

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
          return (
          <span
            /* The second lap is the same connectors, so `source` alone is not
               unique — and duplicate keys in a list this long is React
               silently reusing the wrong node when anything re-renders. */
            key={`${entry.source}-${i}`}
            /* A DARK WASH, NOT A LIGHT ONE. `bg-white/10` lightened the ground
               under the chip's own label, which on the brightened sky put a
               14px name at 4.35:1. Tinting DOWN instead makes the chip
               self-sufficient: it reads the same however light the sky
               underneath it gets, which is one fewer thing coupled to a
               gradient stop. */
            className="glass-chip lift-sm flex shrink-0 items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4"
          >
            {/* THE PRODUCT'S OWN MARK, drawn as a pill. This kept its own copy
                of the tile and its own contrast rule, so the marquee showed two
                letters while the app showed logos — and the yellow-mark caveat
                had to be remembered here separately. */}
            <SourceMark source={entry.source} size={24} radius="9999px" className="stat-numeral" />
            <span className="whitespace-nowrap text-sm font-medium text-foreground">{entry.name}</span>
          </span>
          );
        })}
      </div>
    </div>
  );
}
