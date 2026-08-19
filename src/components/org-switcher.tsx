import { switchOrgAction } from "@/app/actions";

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
      <select
        name="organizationId"
        defaultValue={currentId}
        className="w-full cursor-pointer rounded-control border border-neutral-300 bg-white px-2 py-1.5 text-small font-medium text-foreground focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button type="submit" className="text-micro font-semibold text-brand-600 hover:text-brand-700">
        Switch workspace
      </button>
    </form>
  );
}
