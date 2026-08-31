"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The dashboard's own error boundary — scoped so a board crash keeps the shell.
 *
 * Before this existed, a throw anywhere under /dashboard bubbled to the ROOT
 * boundary and took the entire AppShell frame with it: no rail, no way to
 * navigate to another page, just "Something went wrong" filling the viewport.
 * That is how the canvas's add-crash presented in production — a full-screen
 * dead end for an error one board section deep.
 *
 * A segment boundary renders INSIDE the layout, so the rail survives and the
 * person can walk away to Flows or Apps while the board recovers. The copy
 * names the board rather than "this page", because that is what actually
 * failed; the reassurance sentence is the root boundary's, kept verbatim —
 * one voice for one situation.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // In production the message is redacted to a digest — this console line is
    // the only thread back to the server log. Same rule as the root boundary.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-6 py-24">
      <h1 className="text-display-xs font-semibold text-foreground">The board hit an error</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        An unexpected error interrupted this view. Trying again usually clears it — your data is intact.
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="accent" onClick={reset}>
          Try again
        </Button>
        <Link href="/dashboard" className={cn(buttonVariants({ variant: "secondary" }))}>
          Back to the dashboard
        </Link>
      </div>
      {/* THE DIGEST, ON SCREEN — because "check the console" is not something a
          customer does and was not something WE could do either.
          Next redacts a server error's message in production and replaces it
          with this hash; the same hash is printed beside the real stack in the
          platform log. Without it on screen there is no thread at all between
          "the board hit an error" and the line that caused it — the only
          evidence anybody could hand over was a screenshot of this page, which
          is exactly the position this boundary put us in.
          Rendered only when Next supplies one, so a client-side throw (which
          keeps its real message and has no digest) does not show an empty
          label. */}
      {error.digest && (
        <p className="mt-6 font-mono text-xs text-muted-foreground">
          Reference <span className="text-foreground">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
