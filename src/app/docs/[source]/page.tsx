import type { Metadata } from "next";
import { GuideText } from "@/components/guide-text";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CONNECTOR_CATALOG, catalogEntry } from "@/connectors/catalog";
import { SourceMark } from "@/components/source-mark";

/**
 * ONE APP'S SETUP PAGE — the three clicks that get a key out of the provider's
 * dashboard and into ours.
 *
 * NOT the provider's API reference, which `entry.docs` links out to and which is
 * written for someone building against the API. This is for someone who does not
 * care that there is an API: where to click, what the value looks like, and what
 * is true and awkward about it.
 *
 * PUBLIC AND UNAUTHENTICATED, deliberately. The commonest moment someone needs
 * this is while logged into the PROVIDER in another tab, often on a different
 * machine from the one holding the Namzilabs session — and a docs page that
 * bounces to a sign-in is a docs page nobody reaches. Nothing here is specific to
 * an account: it is the catalog, which ships in the bundle already.
 *
 * EVERY PAGE CARRIES ITS OWN DATE. Whop renamed a parameter between a connector
 * being written and a customer connecting, and a stale instruction looks exactly
 * like a fresh one. `readOn` is printed rather than stored, so a reader can see
 * how old the advice is without asking anyone.
 */

export function generateStaticParams() {
  return CONNECTOR_CATALOG.filter((e) => e.guide).map((e) => ({ source: e.source }));
}

/**
 * THE GUIDED SOURCES ARE THE WHOLE ROUTE SPACE — anything else is a 404 from the
 * router rather than from this component.
 *
 * With `dynamicParams` left at its default, `/docs/klaviyo` rendered the
 * not-found page with an HTTP **200**: `notFound()` chose the right content, and
 * the status line still said the page existed. Measured against a genuinely
 * unmatched path, which answered 404 properly. A soft 404 is the kind of thing
 * that is invisible in a browser and wrong everywhere it matters — search
 * indexes it, an uptime check calls it healthy, and a link checker walks past it.
 *
 * The `notFound()` below stays as the belt: it is what runs if this list and the
 * catalog ever disagree.
 */
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ source: string }> }): Promise<Metadata> {
  const entry = catalogEntry((await params).source);
  if (!entry) return { title: "Not found — Namzilabs" };
  return {
    title: `Connect ${entry.name} — Namzilabs`,
    description: `Where to find the credentials Namzilabs needs to connect ${entry.name}.`,
  };
}

export default async function ConnectorDocsPage({ params }: { params: Promise<{ source: string }> }) {
  const entry = catalogEntry((await params).source);
  /**
   * A source with no guide 404s rather than rendering an empty page. The
   * connect dialog only links here when `guide` is set, so reaching this branch
   * means a hand-typed URL or a guide that was removed — and a page saying
   * nothing is worse than a page that is honestly absent.
   */
  if (!entry?.guide) notFound();
  const { guide } = entry;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <Link href="/docs" className="text-xs text-muted-foreground hover:text-foreground">
        ← All apps
      </Link>

      <header className="mt-4 flex items-center gap-3">
        <SourceMark source={entry.source} size={40} />
        <div className="min-w-0">
          <h1 className="text-display-xs font-semibold text-heading">Connect {entry.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{entry.description}</p>
        </div>
      </header>

      {guide.fields.map((field) => (
        <section key={field.key} className="mt-8">
          <h2 className="text-sm font-semibold text-heading">{field.title}</h2>
          {/* NUMBERED, because these are steps in an order rather than a set of
              facts — and the numbers are the list's own, so a step inserted in
              the middle renumbers the rest instead of being missed. */}
          <ol className="mt-3 space-y-2">
            {field.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-foreground">
                <span className="stat-numeral shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <span><GuideText>{step}</GuideText></span>
              </li>
            ))}
          </ol>
          {field.note && <p className="mt-3 text-xs text-muted-foreground"><GuideText>{field.note}</GuideText></p>}
        </section>
      ))}

      {guide.webhook && (
        <section className="mt-8 border-t border-border pt-8">
          <h2 className="text-sm font-semibold text-heading">Instant updates</h2>
          <ol className="mt-3 space-y-2">
            {guide.webhook.steps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-foreground">
                <span className="stat-numeral shrink-0 text-xs text-muted-foreground">{i + 1}</span>
                <span><GuideText>{step}</GuideText></span>
              </li>
            ))}
          </ol>
          {guide.webhook.note && <p className="mt-3 text-xs text-muted-foreground"><GuideText>{guide.webhook.note}</GuideText></p>}
        </section>
      )}

      <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        {/* THE DATE AND THE SOURCE, TOGETHER. Either alone is half an answer: a
            date with no link cannot be re-checked, and a link with no date cannot
            be doubted. */}
        <p>
          Checked against {entry.name}&rsquo;s own documentation on {guide.readOn}.
          {entry.docs && (
            <>
              {" "}
              Their API reference is{" "}
              <a href={entry.docs.url} target="_blank" rel="noreferrer noopener" className="underline">
                here
              </a>
              .
            </>
          )}
        </p>
        <p className="mt-2">
          Providers move things. If a step here does not match what you see, trust what you see and tell us.
        </p>
      </footer>
    </main>
  );
}
