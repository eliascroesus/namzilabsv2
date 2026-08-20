"use client";

import { EmptyCanvas } from "./flow-canvas";

/**
 * The empty state, for the kit.
 *
 * `EmptyCanvas` takes an `onStart` callback and /design is a server component,
 * so it cannot hand one over directly — the same reason `toolbar-preview` and
 * `panel-preview` exist. This renders the REAL component, unmodified, with the
 * callback stubbed; there is no copy of its markup anywhere, so it cannot drift.
 */
export function EmptyCanvasPreview({ hasConnections }: { hasConnections: boolean }) {
  return <EmptyCanvas hasConnections={hasConnections} onStart={() => {}} />;
}
