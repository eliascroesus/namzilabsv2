"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSignInUrl, getWorkOS, saveSession } from "@workos-inc/authkit-nextjs";
import { safeNext } from "./next-path";

/**
 * HEADLESS AUTHKIT — the forms are ours, the authentication is still WorkOS's.
 *
 * The product used to bounce people to WorkOS's hosted page at
 * `randomphrase.authkit.app`. Moving that onto `auth.namzilabs.co` is a $99/mo
 * add-on; putting the FORM on `namzilabs.co/login` costs nothing, and is what
 * nearly every SaaS does.
 *
 * ═══ WHAT IS OURS AND WHAT IS NOT ═══
 *
 * OURS: the two forms, their error copy, and the verification-code screen.
 *
 * STILL WORKOS'S, deliberately: password hashing and comparison, breach checks,
 * the verification email, token minting, refresh, and the session's signature.
 * Nothing here ever sees a password hash or decides whether a password is
 * correct — it forwards a credential and gets an answer. That line is the whole
 * safety argument for doing this at all.
 *
 * ═══ THE SESSION IS THE SAME SESSION ═══
 *
 * `saveSession` seals exactly what the hosted callback seals —
 * `{ accessToken, refreshToken, user, impersonator, authenticationMethod }` —
 * with the same cookie password and name. So `withAuth()`, `requireOrg()`, the
 * proxy and every page downstream cannot tell which door somebody came through.
 * That is what makes this a swap rather than a rewrite.
 *
 * ═══ THE ESCAPE HATCH ═══
 *
 * `authenticateWithPassword` can answer with things a form cannot finish on its
 * own: an MFA challenge, an organization-selection step, an SSO redirect, and
 * whatever WorkOS adds next. Rather than half-build those — each one a place to
 * get authentication subtly wrong — anything not handled here hands the person
 * to the hosted page, which handles all of them correctly and always will. They
 * see `authkit.app` for that one rare flow and come back through the same
 * callback. A dead end would be worse; a hand-rolled MFA screen worse still.
 */

/** What every action returns to its form. A redirect never returns at all. */
export type AuthResult = { error: string | null };

/** Carries the half-finished login between the password step and the code step. */
const PENDING_COOKIE = "nz-pending-auth";

/**
 * PASSED TO WORKOS SO ITS RATE LIMITING HAS SOMETHING TO WORK WITH.
 *
 * Throttling is keyed on the end user, and a server-side call carries the
 * server's address unless the real one is forwarded. Without this every sign-in
 * attempt in the world looks like one Vercel region, which turns a per-attacker
 * throttle into a global one — the failure mode where an attacker locks out
 * every customer at once.
 */
async function requestOrigin(): Promise<{ ipAddress?: string; userAgent?: string }> {
  const h = await headers();
  // Left-most entry is the client; everything after it is a proxy that appended
  // itself.
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ipAddress: forwarded || undefined, userAgent: h.get("user-agent") ?? undefined };
}

/**
 * `saveSession` derives cookie options (domain, secure) from a URL, and a
 * server action has no request object — so it is rebuilt from the forwarded
 * headers a proxy sets.
 */
async function currentUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** WorkOS errors arrive in several shapes; this is the readable part of any. */
function messageOf(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { message?: unknown; error_description?: unknown; code?: unknown; rawData?: { code?: unknown } };
    for (const v of [e.error_description, e.message]) if (typeof v === "string" && v) return v;
  }
  return "Something went wrong. Please try again.";
}

/** The machine-readable code, wherever this SDK version happens to put it. */
function codeOf(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { code?: unknown; rawData?: { code?: unknown } };
    for (const v of [e.code, e.rawData?.code]) if (typeof v === "string" && v) return v;
  }
  return "";
}

/** The token that lets the code step finish the login the password step began. */
function pendingTokenOf(err: unknown): string | null {
  if (typeof err === "object" && err !== null) {
    const e = err as { pendingAuthenticationToken?: unknown; rawData?: { pending_authentication_token?: unknown } };
    for (const v of [e.pendingAuthenticationToken, e.rawData?.pending_authentication_token]) {
      if (typeof v === "string" && v) return v;
    }
  }
  return null;
}

/** Seal the session and land. Shared by the password step and the code step. */
async function land(
  result: { accessToken: string; refreshToken: string; user: unknown; impersonator?: unknown; authenticationMethod?: unknown },
  next: string,
): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await saveSession(result as any, await currentUrl());
  redirect(next);
}

export async function signInAction(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!email || !password) return { error: "Enter your email and password." };

  let result;
  try {
    result = await getWorkOS().userManagement.authenticateWithPassword({
      clientId: process.env.WORKOS_CLIENT_ID ?? "",
      email,
      password,
      ...(await requestOrigin()),
    });
  } catch (err) {
    const code = codeOf(err);

    // The ordinary sign-up path: WorkOS has emailed a code and handed us a
    // token to finish with. Kept in an httpOnly cookie rather than the URL —
    // it is a credential, and a URL is logged, shared and shoulder-read.
    if (code === "email_verification_required") {
      const token = pendingTokenOf(err);
      if (token) {
        (await cookies()).set(PENDING_COOKIE, token, {
          httpOnly: true,
          secure: !(await currentUrl()).startsWith("http://"),
          sameSite: "lax",
          path: "/",
          maxAge: 600,
        });
        redirect(`/verify-email?next=${encodeURIComponent(next)}`);
      }
    }

    // Anything needing a screen we do not have.
    if (code === "mfa_enrollment" || code === "mfa_challenge" || code === "organization_selection_required" || code === "sso_required") {
      redirect(await getSignInUrl({ returnTo: next }));
    }

    /**
     * ONE MESSAGE FOR "NO SUCH USER" AND FOR "WRONG PASSWORD", deliberately.
     * Telling them apart makes the form an account-existence oracle: an
     * attacker learns which addresses on a leaked list have accounts here.
     * WorkOS already answers both the same way; this is about not undoing that
     * with a more "helpful" message of our own.
     */
    const msg = messageOf(err);
    return { error: /password|credential|invalid|user/i.test(msg) ? "That email and password don't match." : msg };
  }
  return land(result, next);
}

export async function signUpAction(prev: AuthResult, form: FormData): Promise<AuthResult> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter an email and a password." };
  /**
   * A LENGTH FLOOR, NOT A COMPOSITION RULE. WorkOS enforces the real policy —
   * including breach checks — and rejects a weak password with its own message.
   * This only saves an obvious round trip. Demanding a symbol and a digit here
   * would be a second, weaker policy disagreeing with the real one.
   */
  if (password.length < 8) return { error: "Use at least 8 characters." };

  try {
    await getWorkOS().userManagement.createUser({ email, password, ...(await requestOrigin()) });
  } catch (err) {
    const msg = messageOf(err);
    /**
     * An address that already has an account is told so. This one DOES leak
     * existence, and it is the one place that is the right trade: a sign-up
     * form that pretends to succeed strands the customer completely, and every
     * product they have ever used says "that email is taken".
     */
    if (/exist|taken|unique|already/i.test(msg)) return { error: "That email already has an account. Sign in instead." };
    return { error: msg };
  }

  // Straight into a session so nobody types their password twice. A brand-new
  // user can have neither MFA nor a second organization, so the only branch
  // this can take is email verification.
  return signInAction(prev, form);
}

export async function verifyEmailAction(_prev: AuthResult, form: FormData): Promise<AuthResult> {
  const code = String(form.get("code") ?? "").trim();
  const next = safeNext(form.get("next"));
  if (!code) return { error: "Enter the code from your email." };

  const jar = await cookies();
  const pendingAuthenticationToken = jar.get(PENDING_COOKIE)?.value;
  // The token lives ten minutes. Past that the honest answer is "start again",
  // not a generic failure on a screen with no way forward.
  if (!pendingAuthenticationToken) return { error: "That took too long. Please sign in again." };

  let result;
  try {
    result = await getWorkOS().userManagement.authenticateWithEmailVerification({
      clientId: process.env.WORKOS_CLIENT_ID ?? "",
      code,
      pendingAuthenticationToken,
      ...(await requestOrigin()),
    });
  } catch (err) {
    return { error: /code|invalid|expire/i.test(messageOf(err)) ? "That code isn't right, or it expired." : messageOf(err) };
  }
  jar.delete(PENDING_COOKIE);
  return land(result, next);
}
