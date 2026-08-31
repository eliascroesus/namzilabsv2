"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * THE SUBMIT BUTTON — a Button that knows its form is in flight.
 *
 * Every form in this product posts to a server action, and until now not one
 * of them said so. The dashboard's "Refresh" fires `refreshAllFlowsAction`,
 * which marks every published result stale and recomputes the whole workspace
 * inline under a 60-second budget; "Save connection" registers a webhook with
 * a third-party provider before it returns. Both rendered a plain button that
 * stayed idle and clickable for the entire wait, so the honest reading of the
 * screen was "nothing happened" — and the honest response was to click again,
 * which fires the whole thing a second time. On /integrations that produced
 * duplicate connections; on the dashboard, a second full recompute.
 *
 * `useFormStatus` is the whole mechanism, and it has one hard rule: it reports
 * the status of the form ABOVE the component in the tree, so this must be a
 * client component rendered INSIDE the <form>. It cannot be lifted into the
 * server component that owns the form, which is why this exists as its own
 * file rather than as a prop on Button.
 *
 * Deliberately not a new visual language: it is `Button`, with the label
 * swapped for the pending copy and a spinner. One vocabulary — the same
 * "…"-suffixed present participle the builder's toolbar already uses for
 * Saving… / Publishing… / Testing….
 */
export type SubmitButtonProps = Omit<ButtonProps, "type"> & {
  /**
   * What the button says while the action runs. Ends with "…" per the kit, and
   * should be the same verb as the label: "Save changes" → "Saving…", so the
   * control never appears to change into a different control mid-press.
   */
  pendingLabel?: string;
};

export function SubmitButton({
  pendingLabel,
  children,
  disabled,
  className,
  /**
   * THE BRAND, BY DEFAULT, AND IT HAS TO BE STATED HERE RATHER THAN INHERITED.
   *
   * `Button`'s `default` variant used to be a near-black fill — the highest-
   * contrast object on a light page — so a form's submit was automatically the
   * loudest thing in it and this component never had to say so. That variant is
   * a bordered card chip now, which is right for a console's ordinary act and
   * wrong for the one control a form exists to reach: "Save" and "Cancel"
   * rendering as the same object is a form with no primary.
   *
   * A SUBMIT IS THE PRIMARY ACT BY DEFINITION, which is what makes this a
   * default rather than something eleven call sites remember to pass. The
   * destructive submits already pass `variant="destructive"` and are unaffected.
   */
  variant = "accent",
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      // `disabled` while pending is the double-submit guard AND the visual
      // state — one attribute doing both, so they cannot disagree.
      disabled={disabled || pending}
      // A pending button must not also announce itself as unavailable: it is
      // busy, not disabled, and `aria-disabled` alone would leave it clickable.
      aria-busy={pending || undefined}
      className={className}
      {...props}
    >
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
