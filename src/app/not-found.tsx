import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The 404. It points at /dashboard rather than "/" because a bad link almost
 * always comes from inside the product — a deleted flow, a stale bookmark —
 * and an anonymous visitor following it will simply bounce through sign-in.
 */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-display font-semibold text-foreground">Page not found</h1>
      <p className="mt-3 text-base text-muted-foreground">
        This page doesn&rsquo;t exist — the link may be stale, or what it pointed at has been removed.
      </p>
      <div className="mt-6">
        <Link href="/dashboard" className={cn(buttonVariants())}>
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
