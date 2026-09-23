"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AuthResult } from "./actions";
import { GoogleMark } from "@/components/google-mark";

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

/**
 * THE CONTROL HEIGHT ON THIS SCREEN IS THE KIT'S `lg`, NOT ITS DEFAULT.
 *
 * Everything else in the product stands at 32px, which is the console's rung:
 * right for a dense table, mean for the first screen anybody sees. The ladder
 * already has the answer — `lg` exists, in its own words, "for the landing's
 * hero and for a form that genuinely wants air", which is exactly this.
 *
 * 40 AND NOT 44, deliberately. The button's own note argues against a 44 rung
 * ("a lone rung nobody stands on is how the ladder grew a sixth step last
 * time"), and inventing one here for two screens would prove it right.
 *
 * The input follows the button, which is the rule `Input` already documents:
 * a field and the submit beneath it four pixels apart reads as a rendering
 * fault rather than a hierarchy.
 */
const CONTROL = "h-10 text-sm";

/**
 * THE FIELDS, ON BLUE.
 *
 * `Input`'s own recipe is built for a neutral card — `bg-control`, a
 * `border-input` hairline, `text-foreground`. Every one of those is wrong on a
 * deep blue ground: the control fill is a near-white that reads as a hole
 * punched in the card, and the hairline disappears entirely.
 *
 * Translucent white instead, so the field is the card lit from within rather
 * than a separate object sitting on it. The ring stays white too — the kit's
 * `--ring` is the brand blue, which on this ground is invisible, and a focus
 * ring nobody can see is a keyboard user with no idea where they are.
 *
 * MEASURED ACROSS THE GRADIENT, not at one point. `.sky-panel` runs #16305E to
 * #2B53AE, so every alpha here has a best case and a worst case and only the
 * worst one matters. Typed white text in the field is 9.6:1 at the top and
 * 5.65:1 at the foot. The placeholder started at white/60, which measured 3.68
 * where the fields actually sit and 3.13 at the foot — so it is /75, which puts
 * it at 4.81 in place. A placeholder is the one piece of type people are most
 * often told to stop worrying about, and it is the one a person squints at
 * hardest when they cannot remember which field they are in.
 */
const SKY_FIELD =
  "border-white/25 bg-white/10 text-white placeholder:text-white/75 hover:border-white/40 " +
  "focus-visible:border-white/70 focus-visible:ring-white/30";

/**
 * A QUIETER LABEL THAN THE CONSOLE'S.
 *
 * `FieldLabel` is 12px semibold CAPS — correct in a settings panel, where a
 * label has to survive being one of thirty on a page. Here there are two, they
 * are the only labels on the screen, and shouting them put more visual weight
 * on the word "EMAIL" than on the heading above it.
 *
 * It is the same size and colour as the rest of the kit's field furniture; what
 * it drops is the caps and a weight step, which is the whole difference between
 * a dense form and a front door.
 */
function AuthLabel({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-white/85", className)} {...props} />;
}

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
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-[420px] flex-col justify-center px-5 py-16">
      {/**
       * `.sky-panel`, WHICH IS THE INVITE CARD'S FAMILY AND NOT ITS EXACT
       * CLASS — and the difference is the reason the class exists.
       *
       * `.sky-card` is the refer board's, and it opens up to #3F73E6 at the
       * foot because its type all sits in the top half. This card is the shape
       * `.sky-panel` was written for: copy running from the heading to the last
       * line of legal text. Its own note says so — white measures 4.36:1 on
       * `.sky-card`'s foot and 7.1:1 on this one, and half the text here lands
       * exactly where the first of those would fail.
       *
       * `overflow-hidden` because the sky paints a ruled grid through
       * `::before` that would otherwise square off the rounded corners.
       */}
      <div className="sky-panel overflow-hidden rounded-3xl px-7 py-9 shadow-card sm:px-8">
        <h1 className="text-center text-display-xs font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-2 text-center text-sm text-white/75">{subtitle}</p>}
        <div className="mt-7">{children}</div>
        {/* /80, not /70: the footer is the LAST line on the card, which is
            where the gradient is lightest and contrast is worst — 4.37 at /70,
            5.22 at /80. The same arithmetic as the terms line above it. */}
        {footer && <div className="mt-7 text-center text-sm text-white/80">{footer}</div>}
      </div>
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
    /* NOT `bg-danger-soft`: that is a pale wash for a light card, and on this
       ground it is a bright slab that outshouts the form. A deep red at the
       same transparency as the fields keeps the error part of the card. */
    <p role="alert" className="rounded-control border border-white/20 bg-neutral-950/35 px-3 py-2 text-sm text-white">
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
      /**
       * WHITE, at the owner's ask — and it is also what Google's own brand
       * guidance prefers: the four-colour mark is drawn to sit on white, and on
       * a translucent blue it was the one element on the card fighting its
       * background.
       *
       * SO BOTH BUTTONS ARE WHITE NOW, and the hierarchy moved off colour onto
       * position and weight instead: Google is first because it is the faster
       * path, the submit is last because it is the one that completes the form,
       * and the divider between them is what says they are alternatives rather
       * than steps. On a card this size that reads more clearly than one loud
       * button and one quiet one did.
       *
       * `bg-white` spelled out for the same reason as the submit below — the
       * kit's `white` variant follows the theme and this card does not.
       */
      className={cn(
        buttonVariants({ variant: "secondary", size: "lg" }),
        "w-full gap-2.5 border-transparent bg-white text-neutral-950 shadow-xs hover:bg-brand-50 active:bg-brand-50",
      )}
    >
      {/* Shared with the landing page's own Google button. The mark is never
          recoloured, which is why it lives in one file rather than two. */}
      <GoogleMark className="shrink-0" />
      Continue with Google
    </a>
  );
}

function Divider() {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-white/20" />
      <span className="text-xs text-white/75">or</span>
      <span className="h-px flex-1 bg-white/20" />
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
      <form action={formAction} className="space-y-3.5">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-1.5">
          <AuthLabel htmlFor="email">Email</AuthLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@company.com"
            className={cn(CONTROL, SKY_FIELD)}
          />
        </div>
        <div className="space-y-1.5">
          <AuthLabel htmlFor="password">Password</AuthLabel>
          <Input
            id="password"
            name="password"
            type="password"
            /* `new-password` on sign-up is what makes a password manager offer
               to GENERATE one rather than autofill the last one it saw. */
            autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
            required
            /* THE 8-CHARACTER FLOOR IS ENFORCED AND NO LONGER ANNOUNCED. The
               line under the field explained a rule almost nobody was about to
               break, on the screen with the least room for prose; the browser
               says it at the moment it matters instead, which is the only
               moment it is useful. */
            minLength={mode === "sign-up" ? 8 : undefined}
            className={cn(CONTROL, SKY_FIELD)}
          />
        </div>
        <ErrorLine error={state.error} />
        {/**
          * WHITE, NOT THE BRAND FILL — the call `ReferBoard` already makes on
          * this exact ground, in its words: "a #568CFF button on a deep blue
          * ground is a shape you have to hunt for."
          *
          * AND `bg-white` SPELLED OUT, not `variant="white"`. That variant is
          * no longer literally white — its own comment says "THE NAME `white`
          * SURVIVES ITS OWN LITERAL" — it is `bg-secondary`, which follows the
          * theme and resolves to #151515 on dark. This card does NOT follow the
          * theme: `.sky-panel` is three fixed blues in both. So a theme-
          * following fill on a fixed ground gave a black button on blue with
          * black text, invisible, which is exactly what shipped to the
          * screenshot before this comment existed. The same override
          * `ReferBoard` uses, for the same reason.
          */}
        <SubmitButton
          size="lg"
          className="w-full border-transparent bg-white text-neutral-950 shadow-xs hover:bg-brand-50 active:bg-brand-50"
          pendingLabel={pendingLabel}
        >
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
        <AuthLabel htmlFor="code">Verification code</AuthLabel>
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
          className={cn(CONTROL, SKY_FIELD)}
        />
      </div>
      <ErrorLine error={state.error} />
      {/* `bg-white` spelled out — see the note in `CredentialsForm`. */}
      <SubmitButton
        size="lg"
        className="w-full border-transparent bg-white text-neutral-950 shadow-xs hover:bg-brand-50 active:bg-brand-50"
        pendingLabel="Verifying…"
      >
        Verify email
      </SubmitButton>
    </form>
  );
}

export function AuthFooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    /* White, not `text-primary`. The brand blue on a blue card is the same
       "shape you have to hunt for" the refer board's CTA note describes. */
    <Link href={href} className="font-medium text-white underline underline-offset-4 decoration-white/40 hover:decoration-white">
      {children}
    </Link>
  );
}
