import Link from "next/link";
import { Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page";

/**
 * WHAT OPENING A LOCKED FLOW SHOWS — the upgrade dialog's words, as a page.
 * The flow is untouched and comes back the moment the workspace upgrades.
 */
export function LockedFlow({ name }: { name: string }) {
  return (
    <PageContainer width="narrow">
      <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-brand-soft text-marker">
          <Lock size={20} aria-hidden />
        </span>
        <h1 className="text-display-xs font-semibold text-foreground">&ldquo;{name}&rdquo; is past your plan</h1>
        <p className="text-sm text-muted-foreground">
          This flow builds a metric your plan doesn&rsquo;t include, so it&rsquo;s locked — its steps and numbers are hidden until you
          upgrade. Nothing is deleted, and upgrading unlocks every metric at once.
        </p>
        <div className="mt-2 flex gap-2">
          <Link href="/dashboard/flows" className={buttonVariants({ variant: "ghost" })}>
            Back to flows
          </Link>
          <Link href="/dashboard/settings/billing?upgrade=metrics" className={buttonVariants({ variant: "accent" })}>
            See plans
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
