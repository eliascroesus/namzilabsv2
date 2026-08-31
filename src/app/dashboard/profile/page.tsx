/* eslint-disable @next/next/no-img-element */
import { requireOrg } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { PageContainer, PageHeader, SectionHeading } from "@/components/ui/page";
import { AvatarForm, DisplayNameForm } from "./ProfileForms";

export const dynamic = "force-dynamic";

/**
 * YOU, RATHER THAN YOUR WORKSPACE.
 *
 * The one page in the product that is not about a tenant. Settings is where a
 * WORKSPACE is configured — members, ranks, invites — and none of that is what
 * somebody means when they click their own avatar; they mean "my name, my
 * picture". Two different objects, so two different pages, reached from two
 * different places: the workspace from the rail, the person from the account
 * panel that already opens under their initials.
 *
 * IT STILL RENDERS INSIDE `AppShell`, which needs an org. That is not a
 * contradiction — you are always looking at the product from inside a workspace,
 * and a profile page with no rail would be a page you have to navigate back out
 * of. The WRITES take no org (see actions.ts); only the frame does.
 *
 * `<img>` RATHER THAN `next/image`, deliberately. The avatar is a user-supplied
 * URL on a blob host, so the optimizer would need that hostname allow-listed in
 * next.config — one more piece of configuration that fails closed at runtime,
 * on a 96px image where the optimizer saves nothing worth the coupling.
 */
export default async function ProfilePage() {
  const { orgId, userId, auth } = await requireOrg();
  const profile = await getProfile(userId, auth.user.email ?? null);

  return (
    <AppShell userId={userId} orgId={orgId} userEmail={auth.user.email}>
      <PageContainer>
        <PageHeader title="Profile" />

        <Card variant="surface" className="mt-6 max-w-2xl">
          <SectionHeading>Your picture</SectionHeading>
          <div className="mt-4 flex flex-wrap items-center gap-5">
            {/* THE PICTURE AT THE SIZE IT IS JUDGED AT, not at the size it is
                used. The chip in the rail is 28px, and nobody can tell whether
                a crop works at 28px — this is where you look at it. */}
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt=""
                width={96}
                height={96}
                className="size-24 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              /* The SAME chip the rail and the top bar draw, from the same
                 helper — see `initialsOf`. A placeholder that differs from the
                 real thing is a preview of something else. */
              <span
                aria-hidden
                /* `text-display-xs` (24px), not `text-2xl` — the stock scale is
                   cleared from the theme, so an off-kit size compiles to
                   nothing and the letters would have rendered at whatever they
                   inherited. `check:ui` caught this one. */
                className="flex size-24 shrink-0 items-center justify-center rounded-full bg-accent text-display-xs font-semibold text-accent-foreground"
              >
                {profile.initials}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <AvatarForm hasAvatar={profile.avatarUrl != null} />
            </div>
          </div>
        </Card>

        <Card variant="surface" className="mt-4 max-w-2xl">
          <SectionHeading>Your name</SectionHeading>
          <div className="mt-4">
            <DisplayNameForm initial={profile.displayName} />
          </div>
        </Card>

        <Card variant="surface" className="mt-4 max-w-2xl">
          <SectionHeading>Sign-in</SectionHeading>
          {/* NOT EDITABLE, AND IT SAYS SO. The email is WorkOS's fact — it is
              how you sign in — and a field that looks editable but is not is
              worse than a stated one. See `user_profiles`: the IdP
              authenticates, the product owns what you can change. */}
          <p className="mt-3 text-md text-foreground">{auth.user.email ?? "—"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            You sign in with this address. It comes from your account and can&rsquo;t be changed here.
          </p>
        </Card>
      </PageContainer>
    </AppShell>
  );
}
