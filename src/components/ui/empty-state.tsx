import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * NOTHING HERE YET, SAID WELL. An empty screen is the product's first
 * impression of every feature; the app had four different dashed boxes and
 * one section that simply vanished when it had nothing to say.
 */
export type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        // A REAL SURFACE, dashed. It used to be a transparent dashed box, which
        // works on a white page and reads as an unpainted hole on the off-white
        // one — the app's pages are a canvas now and everything with content in
        // it is an island. The border stays dashed: that is what says "this is
        // where something will BE", rather than "this is a thing".
        //
        // Generous on the sheet's rhythm: 32px of inset and an 8px baseline
        // between the four parts, because the one screen with nothing on it is
        // the last place to be cramped about space.
        "flex flex-col items-center rounded-surface border border-dashed border-border bg-card p-8 text-center",
        className,
      )}
    >
      {icon && (
        // THE ONE PIECE OF COLOUR IN AN OTHERWISE EMPTY BOX, and it is the
        // MARKER's: the violet tint carrying the violet ink (`accent` /
        // `accent-foreground` — the 700, because a lucide glyph is a drawn LINE
        // and is read like text, where the 500's 4.41:1 falls short). Not the
        // brand: yellow is a fill under near-black ink, and a near-black glyph
        // on a yellow disc is a button, which this is not — there is one of
        // those in the `action` slot already. It was a grey disc on a grey wash, which
        // on a white card is two neutrals apart and read as a placeholder for
        // the placeholder. A full circle rather than a rounded square, because
        // the sheet is pill-first and this is the one mark in the composition.
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-md font-semibold text-foreground">{title}</p>
      {description && <div className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
