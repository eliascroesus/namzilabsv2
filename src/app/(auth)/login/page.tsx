import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { AuthCard, AuthFooterLink, CredentialsForm } from "../auth-shell";
import { signInAction } from "../actions";
import { safeNext } from "../next-path";

export const metadata = { title: "Sign in · Namzilabs" };

/**
 * `/login` — on our own domain, which is the whole point of the change.
 *
 * `/sign-in` still exists and redirects here, so every link already in the
 * wild, every invite email and every bookmark keeps working.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);

  // Somebody already signed in has no business on this page, and showing them
  // a login form is how a person ends up wondering whether they were logged
  // out. `withAuth()` without `ensureSignedIn` cannot redirect on its own.
  const { user } = await withAuth();
  if (user) redirect(next);

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back."
      footer={<>New here? <AuthFooterLink href="/signup">Create an account</AuthFooterLink></>}
    >
      <CredentialsForm action={signInAction} next={next} mode="sign-in" submitLabel="Sign in" pendingLabel="Signing in…" />
    </AuthCard>
  );
}
