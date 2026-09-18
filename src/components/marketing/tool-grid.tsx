import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";

/**
 * EVERY TOOL IT READS, AS A WALL OF MARKS.
 *
 * WHAT THIS REPLACES. The same list used to be three columns of name-plus-
 * description separated by hairlines — 42 entries, two lines of 14px grey each,
 * about 900px of uninterrupted small type. It was the least-looked-at block on
 * the page and also the most persuasive fact on it: the answer to "does it read
 * MY stack" is a logo somebody recognises, and recognition happens at a glance
 * or not at all. Reading 42 descriptions is not a glance.
 *
 * THE DESCRIPTION IS NOT GONE, it moved to the title attribute and to
 * `/docs/<source>`, where somebody who has already found their tool goes to
 * find out what exactly gets read from it. That is the right order: recognise,
 * then investigate.
 *
 * THE LIST IS THE CATALOGUE ITSELF, never a typed copy of it. An earlier
 * version of this page hard-coded four of the seven connectors that existed
 * then and had fallen behind before anybody noticed; the count in the heading
 * above it is computed from the same array, so the page cannot claim a tool
 * this product does not ship.
 */
export function ToolGrid() {
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {CONNECTOR_CATALOG.map((entry) => (
        <li key={entry.source}>
          {/* HOVER RAISES THE EDGE, NOT THE FILL — the same rule the rail's
              invite card follows. A tinted fill on hover across a grid this
              dense reads as a selection somebody made rather than as the
              cursor passing over. */}
          <span
            title={entry.description}
            className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-border bg-card px-3 py-3 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:border-brand-400"
          >
            <SourceMark source={entry.source} size={28} className="stat-numeral shrink-0" />
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.name}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
