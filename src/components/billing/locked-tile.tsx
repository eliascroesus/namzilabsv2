"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import { cn } from "@/lib/utils";

/**
 * A METRIC THE PLAN DOES NOT INCLUDE — its name, a lock, and a picture.
 *
 * THE PICTURE IS A CONSTANT. The bars below are the same for every locked
 * tile in every workspace and were drawn, not measured: nothing about the
 * metric reaches this component except its name, so there is nothing for a
 * blur to hide and nothing for inspect mode to find. The blur is only what
 * makes a drawing read as "a chart you can't see yet".
 *
 * A click anywhere on the card opens the upgrade dialog; the button in the
 * middle is the same act for the keyboard and for screen readers.
 */

// Decorative heights, fixed at design time. Not data, and never data.
const BARS = [34, 52, 41, 60, 47, 68, 56, 74, 63, 82, 70, 88];

export function LockedTile({ name, className }: { name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* THE CARD TAKES THE CLICK; THE BUTTON IS FOR THE KEYBOARD. A stretched
          `::after` on the button was the first try, and the app's press dip
          (`button:active` translates half a pixel) makes a pressed button the
          containing block of its own pseudo-element — the hit area collapsed to
          the button face mid-press, so a click on the card's corner released
          somewhere else and never arrived. A click on the button bubbles here
          too; opening twice is still open. */}
      <Card
        data-tile-card
        data-locked
        variant="tile"
        padding="none"
        onClick={() => setOpen(true)}
        className={cn("flex h-full min-h-44 cursor-pointer flex-col overflow-hidden", className)}
      >
        <div className="flex min-w-0 items-start justify-between gap-3 px-4 pt-4">
          <p className="truncate text-sm text-muted-foreground">{name}</p>
          <Lock size={14} aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
        </div>
        {/* One grid cell, two layers: the picture, and the button over it. */}
        <div className="grid flex-1 p-4">
          <div aria-hidden className="col-start-1 row-start-1 flex select-none flex-col gap-3">
            <div className="h-7 w-28 rounded-xs bg-foreground/15 blur-[6px]" />
            <svg viewBox="0 0 240 90" preserveAspectRatio="none" className="h-full min-h-12 w-full text-marker opacity-40 blur-[5px]">
              {BARS.map((h, i) => (
                <rect key={i} x={i * 20 + 3} y={90 - h} width={14} height={h} rx={3} fill="currentColor" />
              ))}
            </svg>
          </div>
          <div className="col-start-1 row-start-1 flex items-center justify-center">
            <Button type="button" variant="default" aria-haspopup="dialog" onClick={() => setOpen(true)}>
              <Lock aria-hidden />
              Upgrade to unlock
            </Button>
          </div>
        </div>
      </Card>
      {/* TO THE BODY, AND OUTSIDE THE CARD IN THE TREE. `Modal` is `fixed
          inset-0`, and a board tile sits inside wrappers the layout may
          transform — a transformed ancestor would pin the overlay to the tile.
          Outside the card so a click inside the dialog cannot bubble up to the
          card's own onClick and open it again. */}
      {open &&
        createPortal(
          <UpgradeDialog
            title={`Unlock “${name}”`}
            message="This metric is past what your plan includes, so its numbers are hidden until you upgrade. Nothing is deleted — upgrading unlocks every metric at once."
            href="/dashboard/settings/billing?upgrade=metrics"
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
