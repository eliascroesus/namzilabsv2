import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { AuthCard, AuthFooterLink, CredentialsForm } from "../auth-shell";
import { signUpAction } from "../actions";
import { safeNext } from "../next-path";

export const metadata = { title: "Create an account · Namzilabs" };

/**
 * `/signup`, with `/sign-up` redirecting here so existing links survive.
 *
 * The terms line sits UNDER the button rather than beside a checkbox. A
 * checkbox is a step; a sentence is a disclosure — and the links are the part
 * that actually matters, since they are also what Google's OAuth verification
 * fetches.
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);

  const { user } = await withAuth();
  if (user) redirect(next);

  return (
    <AuthCard
      title="Create your account"
      subtitle="Every number on your dashboard, traced back to the record it came from."
      footer={
        <>
          Already have an account? <AuthFooterLink href="/login">Sign in</AuthFooterLink>
        </>
      }
    >
      <CredentialsForm
        action={signUpAction}
        next={next}
        mode="sign-up"
        submitLabel="Create account"
        pendingLabel="Creating…"
        extra={
          <p className="text-xs text-muted-foreground">
            By creating an account you agree to our <AuthFooterLink href="/terms">Terms</AuthFooterLink> and{" "}
            <AuthFooterLink href="/privacy">Privacy Policy</AuthFooterLink>.
          </p>
        }
      />
    </AuthCard>
  );
}
