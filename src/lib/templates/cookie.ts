/**
 * THE TEMPLATE A VISITOR CHOSE, CARRIED THROUGH SIGN-UP.
 *
 * Pressing "Use this template" on `/t/<code>` while signed out sets this and
 * sends the visitor to `/signup?next=/t/<code>`, so the ordinary route back is
 * the `next` parameter: sign up, land on the template's page again, signed in,
 * and create the workspace from there.
 *
 * The cookie is the route back for everything `next` does not survive — an
 * email-verification detour, an OAuth provider that drops the return path,
 * somebody who signs up tomorrow from a different tab. `/onboarding` reads it
 * and offers the template on the create form, which is where every new
 * account lands whatever path it took. This is the lesson of Notion's
 * published-page duplicate: the template is lost exactly when the visitor
 * leaves to make an account, so it has to be remembered on OUR side.
 *
 * `sameSite: "lax"` for the reason `REFERRAL_COOKIE` gives: sign-up leaves for
 * WorkOS and comes back as a top-level GET, which `strict` would withhold.
 */
export const TEMPLATE_COOKIE = "nz_tpl";

/** Long enough to sign up next week; short enough not to ambush a login in May. */
export const TEMPLATE_COOKIE_DAYS = 14;

export const templateCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: TEMPLATE_COOKIE_DAYS * 24 * 60 * 60,
};
