"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The root error boundary — a client component because Next requires it (the
 * boundary must survive the render that just failed, so it cannot itself be
 * server-rendered). The console.error keeps the real cause reachable: in
 * production the `digest` is the only thread back to the server log, and
 * swallowing it here would leave this page's "something" permanently vague.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-display-xs font-semibold text-foreground">Something went wrong</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        An unexpected error interrupted this page. Trying again usually clears it — your data is intact.
      </p>
      <div className="mt-6 flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/" className={cn(buttonVariants({ variant: "secondary" }))}>
          Back to home
        </Link>
      </div>
    </main>
  );
}
