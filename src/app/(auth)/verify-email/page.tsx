import { AuthCard, VerifyForm } from "../auth-shell";
import { verifyEmailAction } from "../actions";
import { safeNext } from "../next-path";

export const metadata = { title: "Verify your email · Namzilabs" };

/**
 * Only the sign-up path reaches this, and only when the WorkOS environment has
 * "require email verification" switched on. With it off, `signUpAction` lands
 * straight in a session and nobody ever sees this screen — which is why it is
 * reachable by redirect rather than linked from anywhere.
 *
 * THE PENDING TOKEN IS NOT IN THE URL. It is a credential that finishes a
 * half-done login, and a URL is logged by every proxy it passes, kept in
 * history, and read over a shoulder. It rides in an httpOnly cookie that
 * `verifyEmailAction` reads once and deletes.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  return (
    <AuthCard title="Check your email" subtitle="We sent you a code. Enter it to finish signing in.">
      <VerifyForm action={verifyEmailAction} next={next} />
    </AuthCard>
  );
}
