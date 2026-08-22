import { switchOrgAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";

type Org = { id: string; name: string };

/**
 * Server-rendered organization switcher. Submits a server action (no client JS)
 * that calls WorkOS `switchToOrganization`. The target orgId is validated by
 * WorkOS against the user's memberships — the browser cannot switch into an org
 * the user isn't a member of.
 */
/**
 * Lives in the rail's light account panel. A one-workspace user — almost
 * everyone — sees just the name, so the control costs nothing until there is
 * actually something to switch between.
 */
export function OrgSwitcher({ orgs, currentId }: { orgs: Org[]; currentId: string }) {
  const current = orgs.find((o) => o.id === currentId);

  if (orgs.length <= 1) {
    return <p className="truncate text-small font-semibold text-foreground">{current?.name ?? "Workspace"}</p>;
  }

  return (
    <form action={switchOrgAction} className="space-y-1.5">
      <NativeSelect name="organizationId" defaultValue={currentId}>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="link" size="sm" className="px-0">
        Switch workspace
      </Button>
    </form>
  );
}
