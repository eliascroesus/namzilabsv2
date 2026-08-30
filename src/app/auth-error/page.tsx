import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Where a failed sign-in lands. PUBLIC on purpose (matched by the proxy,
 * absent from PROTECTED_PAGE_PREFIXES — the person this page exists for is
 * exactly the person with no session).
 *
 * Before this page, a broken callback answered with the SDK's raw JSON —
 * {"error":{"message":"Something went wrong"...}} — which is what an invited
 * teammate saw as their first impression of the product. The real cause is
 * already in the server log (authkit's callback console.errors it before
 * calling onError); this page's job is only to be human and to name the two
 * things that actually fix the common cases: re-open the link, and sign in
 * with the address the invite was sent to.
 */
export default function AuthErrorPage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-display-xs font-semibold text-foreground">That sign-in didn&rsquo;t finish</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Something interrupted the last step. It&rsquo;s almost always one of these:
      </p>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        <li>
          <b className="font-semibold">Joining from an invite?</b> Open the invite link again and finish in one go —
          and make sure you sign in with <b className="font-semibold">the same email address the invite was sent to</b>.
        </li>
        <li>The page sat open a while before you finished. Just start again — it takes seconds.</li>
      </ul>
      <div className="mt-6 flex gap-3">
        <Link href="/sign-in" className={cn(buttonVariants())}>
          Try signing in again
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: "secondary" }))}>
          Back to home
        </Link>
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        Still stuck? Ask the person who invited you to send a fresh link — invites expire and can be re-sent
        in seconds.
      </p>
    </main>
  );
}
