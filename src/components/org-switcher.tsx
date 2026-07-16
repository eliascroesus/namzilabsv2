import { switchOrgAction } from "@/app/actions";

type Org = { id: string; name: string };

/**
 * Server-rendered organization switcher. Submits a server action (no client JS)
 * that calls WorkOS `switchToOrganization`. The target orgId is validated by
 * WorkOS against the user's memberships — the browser cannot switch into an org
 * the user isn't a member of.
 */
export function OrgSwitcher({ orgs, currentId }: { orgs: Org[]; currentId: string }) {
  const current = orgs.find((o) => o.id === currentId);

  if (orgs.length <= 1) {
    return <span className="text-sm font-medium text-neutral-700">{current?.name ?? "Workspace"}</span>;
  }

  return (
    <form action={switchOrgAction} className="flex items-center gap-2">
      <select
        name="organizationId"
        defaultValue={currentId}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50">
        Switch
      </button>
    </form>
  );
}
