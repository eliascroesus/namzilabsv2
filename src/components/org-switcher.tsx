import { Check } from "lucide-react";
import { switchOrgAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
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
 * Selection is marked the way the sheet marks selection everywhere else, in
 * violet: the 700 for the tick, because the 500 is a FILL colour and measures
 * 4.42:1 on off-white.
 */

/** The row, shared by the current workspace and the ones you can move to, so
 *  the two cannot drift into different heights or insets. */
const ROW = "flex h-9 w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2 text-left text-sm";

export function OrgSwitcher({ orgs, currentId }: { orgs: Org[]; currentId: string }) {
  const current = orgs.find((o) => o.id === currentId);
  const currentName = current?.name ?? "Workspace";

  if (orgs.length <= 1) {
    return (
      <p className={cn(ROW, "font-semibold text-foreground")}>
        <WorkspaceChip name={currentName} className="size-6" />
        <span className="min-w-0 flex-1 truncate">{currentName}</span>
        <Check className="size-4 shrink-0 text-accent-foreground" aria-hidden />
      </p>
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
            <WorkspaceChip name={o.name} className="size-6" />
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
              <WorkspaceChip name={o.name} className="size-6" />
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
            </Button>
          </form>
        ),
      )}
    </div>
  );
}
