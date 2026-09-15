"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input, fieldClasses } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { deleteWorkspaceAction, transferOwnershipAction } from "./danger-actions";

/**
 * THE TWO ACTS THAT CANNOT BE UNDONE, and the one section in the product that
 * is designed to be slightly HARD to use.
 *
 * OWNER ONLY, and the page does not render this for anybody else — but that is
 * a courtesy, exactly as `ViewTab` and the switcher's create row are. The wall
 * is in `danger-actions.ts`, which reads ownership from `workspace_owners` and
 * refuses regardless of what the browser was showing.
 *
 * NOT `canManageRanks`, which gates inviting and roles. An admin who may govern
 * a workspace may not END it, and may certainly not hand it to somebody else.
 *
 * EACH ONE IS BEHIND A DISCLOSURE, and neither opens by default. A destructive
 * control that is one press from a mis-click is a destructive control that will
 * eventually be mis-clicked; two presses with a typed name in between is the
 * shape GitHub, Stripe and Notion all settled on, and it is settled for the
 * same reason. `<details>` rather than state, so this stays one plain form post
 * per act.
 *
 * THE DELETE BUTTON IS DISABLED UNTIL THE NAME MATCHES, and that is the
 * courtesy half. The server checks it again; see `deleteWorkspaceAction` — the
 * confirmation is part of the contract so that no path can destroy a workspace
 * without having established which one.
 */
export function DangerZone({
  workspaceName,
  members,
}: {
  workspaceName: string;
  /** Everybody who could take it over — the owner is already filtered out. */
  members: Array<{ userId: string; email: string }>;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === workspaceName.trim();

  return (
    <section className="rounded-surface border border-destructive/25 bg-danger-soft">
      <header className="px-4 py-4">
        <h2 className="flex items-center gap-2 text-md font-semibold text-danger-ink">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          Danger zone
        </h2>
      </header>

      <div className="divide-y divide-destructive/20 border-t border-destructive/25">
        {/* ── HAND IT OVER ──────────────────────────────────────────────── */}
        <details className="group px-4 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">Transfer ownership</span>
              <span className="block text-xs text-muted-foreground">
                {members.length > 0
                  ? "The new owner gets these controls. You stay a member."
                  : "Invite somebody first — a workspace can only be handed to an active member."}
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-muted-foreground group-open:hidden">Change</span>
          </summary>
          {members.length > 0 && (
            <form action={transferOwnershipAction} className="mt-4 flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">New owner</span>
                {/* A NATIVE `<select>`, not the kit's Radix composite. The
                    whole section is two `<details>` and two plain form posts,
                    and a Radix select would need a hidden input mirroring its
                    value back for the action to read. `fieldClasses` is the
                    same surface every other field in the product wears. */}
                <select name="userId" defaultValue={members[0].userId} className={cn(fieldClasses, "w-full")}>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.email}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton variant="secondary" pendingLabel="Transferring…">
                Transfer
              </SubmitButton>
            </form>
          )}
        </details>

        {/* ── END IT ────────────────────────────────────────────────────── */}
        <details className="group px-4 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">Delete this workspace</span>
              <span className="block text-xs text-muted-foreground">
                Every metric, flow, connection and record. Immediately and permanently.
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-danger-ink group-open:hidden">Delete</span>
          </summary>
          <form action={deleteWorkspaceAction} className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              {/* THE NAME, SPELLED OUT IN THE LABEL rather than left as "type
                  the workspace name". Somebody about to destroy something
                  should not have to go and look up what it is called. */}
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Type <span className="font-semibold text-foreground">{workspaceName}</span> to confirm
              </span>
              <Input
                name="confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                aria-label={`Type ${workspaceName} to confirm`}
                className="w-full"
              />
            </label>
            <SubmitButton variant="destructive" disabled={!matches} pendingLabel="Deleting…">
              Delete forever
            </SubmitButton>
          </form>
        </details>
      </div>
    </section>
  );
}
