import type { Metadata } from "next";
import Link from "next/link";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";

export const metadata: Metadata = {
  title: "Connecting your apps — Namzilabs",
  description: "Where to find the credentials Namzilabs needs, app by app.",
};

/**
 * THE INDEX LISTS ONLY WHAT HAS BEEN CHECKED, and that is the whole editorial
 * rule of this section.
 *
 * Every connector in the catalog could be given a page today by rendering the
 * strings already sitting in its entry — and several of those strings are older
 * than the provider's current interface. Whop's told customers to paste a
 * Company ID filtered by a parameter the API had since renamed. A page written
 * from memory is indistinguishable, to a reader, from one written from the
 * provider's own docs this week.
 *
 * So a source appears here when somebody has opened the provider's documentation
 * and written the steps down with the date on them. The rest keep the copy
 * already in their connect dialog, which is no worse than it was — it is simply
 * not promoted to a page that implies it was verified.
 */
export default function DocsIndexPage() {
  // A switched-off connector's guide still answers a direct link, but is not listed.
  const documented = CONNECTOR_CATALOG.filter((e) => e.guide && !e.off).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-display-xs font-semibold text-heading">Connecting your apps</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Where to click in each app to find what Namzilabs asks for, and what the value should look like.
      </p>

      <ul className="mt-8 space-y-1">
        {documented.map((entry) => (
          <li key={entry.source}>
            <Link
              href={`/docs/${entry.source}`}
              className="flex items-center gap-3 rounded-control border border-transparent px-2 py-2 hover:border-border"
            >
              <SourceMark source={entry.source} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-heading">{entry.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
              </span>
              <span className="tnum shrink-0 text-2xs text-muted-foreground">{entry.guide!.readOn}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
        Every other app Namzilabs connects to keeps its instructions inside the connect dialog. They are written down
        here as they are checked, with the date they were checked on — a guide nobody can date is a guide nobody can
        audit.
      </p>
    </main>
  );
}
