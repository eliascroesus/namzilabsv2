/**
 * The root route-transition fallback. Deliberately near-empty: it flashes for
 * however long a server component takes to stream, so anything louder than a
 * quiet pulse reads as jank rather than progress.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas-bg">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" />
        Loading…
      </p>
    </div>
  );
}
