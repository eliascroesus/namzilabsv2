import { switchOrgAction } from "@/app/actions";

type Org = { id: string; name: string };

/**
 * Server-rendered organization switcher. Submits a server action (no client JS)
 * that calls WorkOS `switchToOrganization`. The target orgId is validated by
 * WorkOS against the user's memberships — the browser cannot switch into an org
 * the user isn't a member of.
 */
/**
 * Styled for the dark rail, which is now the only place it renders. A
 * one-workspace user — almost everyone — sees just the name, so the control
 * costs nothing until there is actually something to switch between.
 */
export function OrgSwitcher({ orgs, currentId }: { orgs: Org[]; currentId: string }) {
  const current = orgs.find((o) => o.id === currentId);

  if (orgs.length <= 1) {
    return <span className="block truncate text-tiny font-medium text-ink-100">{current?.name ?? "Workspace"}</span>;
  }

  return (
    <form action={switchOrgAction}>
      <select
        name="organizationId"
        defaultValue={currentId}
        className="w-full cursor-pointer rounded-control border border-ink-700 bg-ink-900 px-1.5 py-1 text-tiny font-medium text-ink-100 focus:border-brand-500 focus:outline-none"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id} className="bg-ink-900 text-ink-100">
            {o.name}
          </option>
        ))}
      </select>
      <button type="submit" className="mt-1 text-micro font-medium text-brand-400 hover:text-brand-300">
        Switch workspace
      </button>
    </form>
  );
}
