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
      /* NO SUBTITLE. It carried the product's pitch — "every number on your
         dashboard, traced back to the record it came from" — to somebody who
         has already decided to sign up. They came here to type an email, and
         two lines of marketing above the field is the thing standing between
         them and that. The pitch belongs on the landing page, which is where
         they read it before clicking through. */
      title="Create your account"
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
          /* Two words shorter, and it now reads as one line rather than
             wrapping onto two under the button. The links are the part that has
             to be there — they are also what Google's OAuth verification
             fetches. */
          /* `text-muted-foreground` is a NEUTRAL token — a grey tuned for the
             app's card, which on this blue came out at barely 2:1. And /70 is
             not enough either: this line sits at the card's FOOT, where the
             gradient is lightest, and it measured 4.37 there. /80 is 5.22. */
          <p className="pt-1 text-center text-xs text-white/80">
            By continuing you agree to our <AuthFooterLink href="/terms">Terms</AuthFooterLink> and{" "}
            <AuthFooterLink href="/privacy">Privacy</AuthFooterLink>.
          </p>
        }
      />
    </AuthCard>
  );
}
