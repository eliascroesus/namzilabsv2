"use client";

import { useState } from "react";
import { FlowToolbar } from "./FlowToolbar";

/**
 * The builder's toolbar, on the UI kit page.
 *
 * It needs its own client boundary: `/design` is a server component, and a
 * server component cannot hand function props to a client one — the page
 * 500s with "Event handlers cannot be passed to Client Component props". So
 * the no-op handlers are created here, on the client, and the real
 * `FlowToolbar` renders unmodified.
 *
 * The name is real state so the field can be typed in, which is the only part
 * of this toolbar worth exercising on a static page.
 */
export function ToolbarPreview() {
  const [name, setName] = useState("Speed to lead");
  const noop = () => {};
  return (
    <FlowToolbar
      name={name}
      onRename={setName}
      saveState="saved"
      onRetrySave={noop}
      onDuplicate={noop}
      onDelete={noop}
      onTestAll={noop}
      onStopTestAll={noop}
      runAll={null}
      showTestAll
      publishedVersion={3}
      isPublished
      publishing={false}
      onReview={noop}
      onUndo={noop}
      onRedo={noop}
      canUndo
      canRedo={false}
      onZoomIn={noop}
      onZoomOut={noop}
      onFitView={noop}
      zoomPct={100}
      onToggleEnabled={noop}
      togglingEnabled={false}
    />
  );
}
