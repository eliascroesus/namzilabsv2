import Link from "next/link";
import { ArrowLeft, Check, ChevronRight, LayoutTemplate } from "lucide-react";
import { createOrganizationAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/page";
import { SubmitButton } from "@/components/ui/submit-button";
import { SourceMark } from "@/components/source-mark";
import { sourceStyle } from "@/components/flow/controls/source-style";
import { TemplatePreview } from "@/components/templates/template-preview";
import { summarize, type TemplateSnapshot } from "@/lib/templates/snapshot";
import { addTemplateToWorkspaceAction, startWithTemplateAction } from "./actions";

/**
 * WHAT `/t/<code>` DRAWS — split from the route so it can be drawn without a
 * database or a session.
 *
 * The route (`[code]/page.tsx`) does the three reads — the template, who is
 * looking, and the name of the workspace they are in — and hands this the
 * answers. `/design/templates` hands it fixtures instead, which is how the one
 * page a stranger ever sees of this feature gets looked at in a browser before
 * it ships (see that page's note).
 */

/** Who is looking — the call to action is whichever of these is true. */
export type TemplateViewer =
  | { kind: "signedOut" }
  | { kind: "noWorkspace" }
  | { kind: "inWorkspace"; workspaceName: string | null; mine: boolean };

export type LandingTemplate = {
  code: string;
  name: string;
  description: string | null;
  authorName: string | null;
  snapshot: TemplateSnapshot;
};

/** An unknown code, a link turned off, or tables not there yet — one page for all three. */
export function TemplateUnavailable({ unavailable }: { unavailable: boolean }) {
  return (
    <Shell>
      <EmptyState
        className="mt-10"
        icon={<LayoutTemplate />}
        title="This template isn't available"
        description={
          unavailable
            ? "Templates are still being switched on. Try the link again a little later."
            : "The link may have been turned off by the person who shared it, or mistyped. Ask them for a fresh one."
        }
        action={
          <Button asChild variant="accent">
            <Link href="/">Go to Namzilabs</Link>
          </Button>
        }
      />
    </Shell>
  );
}

export function TemplateLanding({
  template,
  viewer,
  error,
}: {
  template: LandingTemplate;
  viewer: TemplateViewer;
  /** Already mapped to our own words — never a string from the URL. */
  error: string | null;
}) {
  const snapshot = template.snapshot;
  const summary = summarize(snapshot);
  const { code } = template;
  const self = `/t/${code}`;

  const facts = [
    `${summary.views} ${summary.views === 1 ? "view" : "views"}`,
    `${summary.slots} ${summary.slots === 1 ? "place" : "places"} for a metric`,
  ].join(" · ");

  return (
    <Shell signedIn={viewer.kind !== "signedOut"} next={self}>
      <SectionHeading className="mb-0">Template</SectionHeading>
      <h1 className="mt-2 text-display-xs font-semibold text-foreground">{template.name}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {template.authorName ? `Shared by ${template.authorName} · ` : ""}
        {facts}
      </p>
      {template.description && <p className="mt-3 max-w-2xl text-md text-foreground">{template.description}</p>}

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <TemplatePreview snapshot={snapshot} />

        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <Card variant="surface" className="p-5">
            {viewer.kind === "inWorkspace" && viewer.mine && (
              <p className="mb-4 rounded-control bg-muted px-3 py-2 text-xs text-muted-foreground">
                You shared this. It&rsquo;s exactly what people see when they open the link.{" "}
                <Link href="/dashboard/settings#templates" className="font-medium text-marker underline-offset-4 hover:underline">
                  Manage it
                </Link>
              </p>
            )}
            {error && (
              <p role="alert" className="mb-4 rounded-control border border-danger-soft bg-danger-soft/50 px-3 py-2 text-sm text-danger-ink">
                {error}
              </p>
            )}

            {viewer.kind === "signedOut" ? (
              <>
                <form action={startWithTemplateAction}>
                  <input type="hidden" name="code" value={code} />
                  <SubmitButton pendingLabel="One moment…" className="w-full">
                    Use this template
                  </SubmitButton>
                </form>
                <p className="mt-3 text-xs text-muted-foreground">
                  Free to start. You&rsquo;ll create an account, and your new workspace opens with these views already
                  laid out.
                </p>
                <p className="mt-3 text-center text-sm text-muted-foreground">
                  Have an account?{" "}
                  <Link
                    href={`/login?next=${encodeURIComponent(self)}`}
                    className="font-medium text-marker underline-offset-4 hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </>
            ) : viewer.kind === "noWorkspace" ? (
              <NewWorkspaceForm code={code} submit="Create my workspace" />
            ) : (
              <>
                <form action={addTemplateToWorkspaceAction}>
                  <input type="hidden" name="code" value={code} />
                  <SubmitButton pendingLabel="Adding…" className="w-full">
                    {viewer.workspaceName ? `Add to ${viewer.workspaceName}` : "Add to this workspace"}
                  </SubmitButton>
                </form>
                <p className="mt-3 text-xs text-muted-foreground">
                  Adds {summary.views === 1 ? "its view" : `its ${summary.views} views`} after your own. Nothing you
                  already have changes.
                </p>
                <details className="group mt-4 border-t border-border pt-4">
                  {/* The onboarding page's disclosure, chevron and all — the one
                      spelling of "there is more here" this product uses. */}
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />
                    Or start a new workspace from it
                  </summary>
                  <NewWorkspaceForm code={code} submit="Create workspace" className="mt-3" />
                </details>
              </>
            )}
          </Card>

          <Card variant="surface" className="p-5">
            <SectionHeading className="mb-2">What you get</SectionHeading>
            <ul className="space-y-2 text-sm text-foreground">
              <Point>The views, charts and layout above, ready to fill in.</Point>
              <Point>A note on every empty spot saying which metric goes there.</Point>
              <Point>
                None of {template.authorName ? `${template.authorName}'s` : "the author's"} data, apps or people — your
                numbers stay yours.
              </Point>
            </ul>
            {summary.apps.length > 0 && (
              <>
                <SectionHeading className="mb-2 mt-5">Apps it uses</SectionHeading>
                <ul className="flex flex-wrap gap-2">
                  {summary.apps.map((a) => (
                    <li
                      key={a}
                      className="flex items-center gap-1.5 rounded-control border border-border bg-card px-2 py-1 text-xs text-foreground"
                    >
                      <SourceMark source={a} size={14} />
                      {sourceStyle(a).label}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">You connect your own accounts once you&rsquo;re in.</p>
              </>
            )}
          </Card>
        </aside>
      </div>
    </Shell>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <Check size={16} className="mt-0.5 shrink-0 text-marker" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/**
 * NAME IT, CREATE IT. The one place a workspace is made is
 * `createOrganizationAction`; this form only adds the template's code, which
 * that action applies to the new workspace before landing on its first view.
 */
function NewWorkspaceForm({ code, submit, className }: { code: string; submit: string; className?: string }) {
  return (
    <form action={createOrganizationAction} className={className}>
      <input type="hidden" name="template" value={code} />
      <FieldLabel htmlFor={`ws-${code}`}>Name your workspace</FieldLabel>
      <Input id={`ws-${code}`} name="name" required maxLength={60} placeholder="Your business" />
      <SubmitButton pendingLabel="Creating…" className="mt-3 w-full">
        {submit}
      </SubmitButton>
    </form>
  );
}

/** The page's frame: the way home, and the way in for somebody signed out. */
function Shell({ children, signedIn, next }: { children: React.ReactNode; signedIn?: boolean; next?: string }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-6 items-center gap-1.5 rounded-control text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Namzilabs
        </Link>
        {signedIn ? (
          <Link href="/dashboard" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Open your dashboard
          </Link>
        ) : next ? (
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Sign in
          </Link>
        ) : null}
      </header>
      <main id="main" className="mx-auto max-w-6xl px-5 pb-16 pt-4 sm:px-6">
        {children}
      </main>
    </div>
  );
}
