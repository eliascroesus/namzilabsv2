"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AuthResult } from "./actions";

/**
 * THE FIRST SCREEN ANYBODY SEES, and it is the product's own screen now rather
 * than a WorkOS page wearing our colours.
 *
 * It is deliberately built out of the same kit as the rest of the app — the
 * same `Input`, the same `SubmitButton`, the same card recipe — so that the
 * step from signing in to the dashboard is not a step between two designs. The
 * hosted page could be branded to look close; it could not be built from the
 * same components, and "close" is exactly what a customer notices.
 */

/** One card, centred, on the app's own ground. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="text-display-xs font-semibold text-heading">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-6">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
    </main>
  );
}

/**
 * The error line. `role="alert"` rather than a coloured paragraph: a failed
 * sign-in is the one moment a screen reader user is most likely to be lost,
 * and the message has to announce itself rather than wait to be found.
 */
function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-ink">
      {error}
    </p>
  );
}

/**
 * GOOGLE ABOVE THE FORM, and separated by a rule.
 *
 * Someone who signed up with Google looks for that button first, and making
 * them read past an email field to find it is the whole of that friction. The
 * rule under it is what stops the two being read as one form.
 */
function GoogleButton({ next }: { next: string }) {
  return (
    <a
      href={`/auth/google?next=${encodeURIComponent(next)}`}
      className={cn(buttonVariants({ variant: "secondary" }), "w-full gap-2.5")}
    >
      {/* Google's own four colours. Their brand guidelines are explicit that
          the mark is not recoloured, and this is the same rule the connector
          logos follow. */}
      <svg aria-hidden width="16" height="16" viewBox="0 0 48 48" className="shrink-0">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
      Continue with Google
    </a>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * The email + password pair, shared by sign-in and sign-up because they differ
 * in exactly two things: the autocomplete hint the browser needs to offer the
 * right password, and the words on the button.
 */
export function CredentialsForm({
  action,
  next,
  submitLabel,
  pendingLabel,
  mode,
  extra,
}: {
  action: (prev: AuthResult, form: FormData) => Promise<AuthResult>;
  next: string;
  submitLabel: string;
  pendingLabel: string;
  mode: "sign-in" | "sign-up";
  extra?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, { error: null } as AuthResult);
  return (
    <>
      <GoogleButton next={next} />
      <Divider />
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-1.5">
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus placeholder="you@company.com" />
        </div>
        <div className="space-y-1.5">
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            /* `new-password` on sign-up is what makes a password manager offer
               to GENERATE one rather than autofill the last one it saw. */
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            minLength={mode === "sign-up" ? 8 : undefined}
          />
          {mode === "sign-up" && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
        </div>
        <ErrorLine error={state.error} />
        <SubmitButton className="w-full" pendingLabel={pendingLabel}>
          {submitLabel}
        </SubmitButton>
        {extra}
      </form>
    </>
  );
}

/** The verification-code step, which only the sign-up path reaches. */
export function VerifyForm({
  action,
  next,
}: {
  action: (prev: AuthResult, form: FormData) => Promise<AuthResult>;
  next: string;
}) {
  const [state, formAction] = useActionState(action, { error: null } as AuthResult);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="space-y-1.5">
        <FieldLabel htmlFor="code">Verification code</FieldLabel>
        <Input
          id="code"
          name="code"
          /* `one-time-code` is what lets iOS and Android offer the code from
             the notification instead of making somebody switch apps. */
          autoComplete="one-time-code"
          inputMode="numeric"
          required
          autoFocus
          placeholder="123456"
        />
      </div>
      <ErrorLine error={state.error} />
      <SubmitButton className="w-full" pendingLabel="Verifying…">
        Verify email
      </SubmitButton>
    </form>
  );
}

export function AuthFooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
