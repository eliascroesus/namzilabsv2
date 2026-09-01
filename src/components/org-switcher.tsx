import { Check, Plus } from "lucide-react";
import { createOrganizationAction, switchOrgAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { WorkspaceChip } from "@/components/sidebar";
import { cn } from "@/lib/utils";

type Org = { id: string; name: string };

/**
 * Server-rendered organization switcher. Submits a server action (no client JS)
 * that calls WorkOS `switchToOrganization`. The target orgId is validated by
 * WorkOS against the user's memberships — the browser cannot switch into an org
 * the user isn't a member of.
 */
/**
 * Lives in the account menu behind the rail's workspace control. A
 * one-workspace user — almost everyone — sees just the current workspace, so
 * the control costs nothing until there is actually something to switch
 * between.
 *
 * IT WAS A `<select>` AND A LINK, AND THAT WAS THE WRONG OBJECT.
 *
 * A native combo box inside a floating menu is a menu inside a menu: it opens
 * the operating system's own list, in the OS's font, over the panel that
 * launched it — and then asks for a second press on a "Switch workspace" link
 * to commit. Two decisions for what is one decision, in a shape the rest of the
 * kit does not draw anywhere.
 *
 * The list IS the control now. Each workspace is a menu ROW — the panel's own
 * grammar: `rounded-control`, the chip that identifies it, one press to go.
 *
 * SELECTION HERE IS THE MARKER'S, WHICH IS NOT THE SAME ANSWER THE RAIL GIVES.
 * A selected rail chip is a filled object and takes the brand; a selected menu
 * row is a WASH behind ink, and `--accent`/`--accent-foreground` are the
 * marker's tint pair for exactly that case — a yellow wash under yellow ink is
 * the one combination the fill/stroke split forbids. So the tick is
 * `accent-foreground`, the violet's INK step: the 500 measures 4.41:1, which
 * clears the 3:1 a rule owes and not the 4.5:1 a glyph read as text does, and
 * the 700 is 6.79:1.
 */

/** The row, shared by the current workspace and the ones you can move to, so
 *  the two cannot drift into different heights or insets. */
const ROW = "flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-left text-sm";

export function OrgSwitcher({
  orgs,
  currentId,
  canCreate = false,
}: {
  orgs: Org[];
  currentId: string;
  /**
   * WHETHER TO OFFER A NEW ONE — false once this person has created their
   * allowance (`workspaceCap`, three for now).
   *
   * A COURTESY, NOT THE GATE. `createOrganizationAction` counts again and
   * refuses, because a server action is a public endpoint whatever the menu
   * happens to be drawing. Hidden rather than disabled: `ViewTab` already
   * states the rule — a control advertising something the product will refuse
   * is worse than one that is not there.
   */
  canCreate?: boolean;
}) {
  const current = orgs.find((o) => o.id === currentId);
  const currentName = current?.name ?? "Workspace";

  if (orgs.length <= 1) {
    return (
      <div className="space-y-0.5">
        <p className={cn(ROW, "font-semibold text-foreground")}>
          <WorkspaceChip id={currentId} name={currentName} className="size-6" />
          <span className="min-w-0 flex-1 truncate">{currentName}</span>
          <Check className="size-4 shrink-0 text-accent-foreground" aria-hidden />
        </p>
        {canCreate && <NewWorkspaceRow />}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {orgs.map((o) =>
        o.id === currentId ? (
          // The one you are in is not a button. It has nowhere to take you, and
          // a pressable row that reloads the page into itself is the kind of
          // dead affordance that makes a menu feel unfinished.
          <p key={o.id} className={cn(ROW, "font-semibold text-foreground")} aria-current="true">
            <WorkspaceChip id={o.id} name={o.name} className="size-6" />
            <span className="min-w-0 flex-1 truncate">{o.name}</span>
            <Check className="size-4 shrink-0 text-accent-foreground" aria-hidden />
          </p>
        ) : (
          <form key={o.id} action={switchOrgAction}>
            <input type="hidden" name="organizationId" value={o.id} />
            {/* A Button, wearing the menu's row shape rather than the kit's
                pill: `rounded-full` is what `buttonVariants` opens with, and
                the ARBITRARY spelling of the control radius is the one that
                displaces it — `rounded-control` is not a radius tailwind-merge
                knows, so the two would both survive `cn()` and the pill would
                win on stylesheet order alone. Hover takes the menu's own
                `accent` wash, not the ghost button's neutral one, so a row here
                highlights exactly like a row in any other panel. */}
            <Button
              type="submit"
              variant="ghost"
              size="sm"
              className={cn(ROW, "justify-start font-normal text-foreground hover:bg-accent hover:text-accent-foreground")}
            >
              <WorkspaceChip id={o.id} name={o.name} className="size-6" />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
            </Button>
          </form>
        ),
      )}
      {canCreate && <NewWorkspaceRow />}
    </div>
  );
}

/**
 * MAKE ANOTHER ONE — the row under the list, because that is where somebody
 * looking at their workspaces goes to add one.
 *
 * A `<details>` RATHER THAN A MODAL, and the reason is where it lives: this
 * panel is itself a floating menu, and opening a dialog from inside one either
 * closes the menu underneath it (so the list you were reading vanishes) or
 * stacks two layers of overlay. The disclosure expands the row into a field in
 * place, which keeps the workspace list visible while you name the new one.
 *
 * It also means the whole thing is a plain form post with no client boundary —
 * the same property the switcher rows already have, and `createOrganizationAction`
 * ends in a redirect, so there is no result to read.
 */
function NewWorkspaceRow() {
  return (
    <details className="group/new">
      <summary
        className={cn(
          ROW,
          "cursor-pointer list-none font-normal text-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&::-webkit-details-marker]:hidden",
        )}
      >
        {/* A DASHED SQUARE WHERE THE OTHER ROWS HAVE A FILLED CHIP — the
            conventional "this one does not exist yet" mark, at exactly the size
            of the chips above it so the column of glyphs stays a column. */}
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-dashed border-border text-muted-foreground"
        >
          <Plus className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate">New workspace</span>
      </summary>
      <form action={createOrganizationAction} className="mt-1 space-y-2 px-2 pb-1">
        <Input
          name="name"
          required
          maxLength={60}
          placeholder="Workspace name"
          aria-label="Workspace name"
          className="h-9"
        />
        <SubmitButton size="sm" className="w-full" pendingLabel="Creating…">
          Create workspace
        </SubmitButton>
        {/* WHAT IT DOES BEFORE IT DOES IT. Creating a workspace SWITCHES you
            into it — `createOrganizationAction` ends in `switchToOrganization`,
            which redirects — and being moved out of the workspace you were
            reading is a surprise worth one line of warning. */}
        <p className="text-xs text-muted-foreground">You&rsquo;ll be switched into it.</p>
      </form>
    </details>
  );
}
