"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { deleteAccountAction } from "@/app/dashboard/settings/danger-actions";

/**
 * ENDING AN ACCOUNT — the most destructive control in the product, and the only
 * one whose blast radius reaches other people.
 *
 * WHAT IT SAYS OUT LOUD, AND WHY THAT IS NOT "TOO MUCH TEXT". The standing rule
 * on this product is to prefer an ⓘ over description prose, and it is about
 * DESCRIPTIONS OF CONTROLS. This is a list of consequences, one of which is
 * that other people lose a workspace — and a consequence somebody has to hover
 * to discover is one they discover afterwards. Three lines, each naming a
 * different thing that ends.
 *
 * THE CONFIRMATION IS THE EMAIL, not a workspace name. This act is not about
 * any one workspace, and an account has exactly one name its owner cannot
 * mistype. `deleteAccountAction` compares it again on the server: the
 * confirmation is part of the contract, not a courtesy in the browser.
 */
export function DeleteAccount({ email, ownedWorkspaces }: { email: string; ownedWorkspaces: string[] }) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  return (
    <section className="mt-4 rounded-surface border border-destructive/25 bg-danger-soft">
      <header className="px-4 py-4">
        <h2 className="flex items-center gap-2 text-md font-semibold text-danger-ink">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          Delete your account
        </h2>
      </header>

      <details className="group border-t border-destructive/25 px-4 py-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 text-sm text-muted-foreground">
            Immediately and permanently. There is no undo and no grace period.
          </span>
          <span className="shrink-0 text-xs font-semibold text-danger-ink group-open:hidden">Delete</span>
        </summary>

        <ul className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
          <li>Your profile, your referral link and everything it has earned.</li>
          {/* THE WORKSPACES ARE NAMED. "Workspaces you own will be deleted" is
              a sentence somebody reads past; the list is the one thing that
              makes them stop and check. */}
          {ownedWorkspaces.length > 0 ? (
            /* THE SENTENCE IS BUILT ABOVE, NOT SPLICED HERE. Prose interleaved
               with expressions across a line break leaves the leading space for
               a transform to decide — `tests/jsx-whitespace.test.ts` names the
               line, and it named this one. */
            <li>
              <span className="font-semibold text-danger-ink">{ownedWorkspaces.join(", ")}</span>
              {ownedWorkspaces.length === 1
                ? " — this workspace and everything in it, for everyone in it, not just you."
                : " — these workspaces and everything in them, for everyone in them, not just you."}
            </li>
          ) : (
            <li>You own no workspaces, so none will be deleted.</li>
          )}
          <li>Your place in any workspace somebody else owns. Those workspaces stay.</li>
        </ul>

        <form action={deleteAccountAction} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Type <span className="font-semibold text-foreground">{email}</span> to confirm
            </span>
            <Input
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              aria-label={`Type ${email} to confirm`}
              className="w-full"
            />
          </label>
          <SubmitButton variant="destructive" disabled={!matches} pendingLabel="Deleting…">
            Delete my account
          </SubmitButton>
        </form>
      </details>
    </section>
  );
}
