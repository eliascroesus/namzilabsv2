import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE LEGAL PAGE SHELL.
 *
 * /privacy and /terms were two copies of one layout that had already drifted
 * apart in small ways, and both were the last pages in the product still
 * written in raw palette classes — `text-neutral-700` body, `text-neutral-500`
 * captions, and links in `text-blue-600` on a product whose own kit says, in
 * as many words, "blue is dead". A visitor reading the privacy policy was
 * looking at a different piece of software from the one they had just been
 * shown.
 *
 * These are also the pages someone reads when they are deciding whether to
 * trust you with their CRM, so "nobody reads the legal pages" is exactly
 * backwards about who is reading them and why.
 *
 * `prose` here is hand-rolled rather than a plugin: the kit already owns every
 * value a document needs, and the whole point is that these pages are set in
 * the SAME type scale as the app rather than a parallel one.
 */
export function LegalPage({
  title,
  updated,
  children,
  also,
}: {
  title: string;
  /** Pre-formatted; these are edit dates, not data, so they are written not computed. */
  updated: string;
  children: React.ReactNode;
  also: { href: string; label: string };
}) {
  return (
    <div className="min-h-dvh bg-background">
      <main id="main" className="mx-auto max-w-2xl px-5 py-12 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="inline-flex min-h-6 items-center gap-1.5 rounded-control text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Namzilabs
        </Link>

        <h1 className="font-display mt-8 text-display-xs font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        {/* `space-y-10` between sections and a measure capped by the container:
            a legal document is the one place in this product where somebody
            reads more than two consecutive sentences, so it gets reading
            leading rather than the app's denser UI leading. */}
        <div className="mt-10 space-y-10">{children}</div>

        <p className="mt-14 border-t border-border pt-6 text-sm text-muted-foreground">
          See also our{" "}
          <Link href={also.href} className="font-medium text-marker-ink underline-offset-4 hover:underline">
            {also.label}
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

/** One numbered or titled clause. The `h2` recipe for documents, not for app chrome. */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      {/* 16px, WHERE THE APP'S BODY IS 14 — the one deliberate exception, and
          it is about the surface rather than the token.
          `text-sm` is the interface's body size: it is set for labels, table
          cells and config panels, where the reader is SCANNING and density is
          the point. This is a document somebody has to READ, paragraph after
          paragraph, and 14px is a measurably worse size for that — which is why
          the same `leading-relaxed` is here and nowhere in the app chrome.
          `text-md` is the kit's own reading step; the landing's step copy takes
          it for the same reason. */}
      <div className="mt-3 space-y-3 text-md leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/**
 * A link inside legal prose — the kit's link recipe, so it can never be blue
 * again.
 *
 * `marker-ink` rather than `primary`, which is the fill/stroke split at its
 * plainest: a link is TEXT, and the brand's yellow measures 1.55:1 as text on
 * white. `--marker-ink` is the step that exists to carry words (6.79:1 light,
 * and it climbs the ramp to marker-300 in dark rather than vanishing), and it is
 * the same violet the crumb trail and the `link` Button hover to.
 */
export function LegalLink({ className, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className={cn(
        "rounded-control font-medium text-marker-ink underline underline-offset-4 hover:no-underline",
        className,
      )}
      {...props}
    />
  );
}

/** The bulleted list used inside a clause. */
export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-neutral-400">{children}</ul>;
}
