import { catalogEntry } from "@/connectors/catalog";
import { fetchJson } from "@/lib/http-client";
import { META_GRAPH, META_GRAPH_VERSION } from "@/connectors/meta-ads";
import { TIKTOK_API_VERSION } from "@/connectors/tiktok-ads";

export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt: number; email?: string };

export type OAuthProvider = {
  key: string;
  /** Display name for messages: "Google access has expired…". */
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  /**
   * WHERE TO HAND THE GRANT BACK, if the provider has such an endpoint.
   *
   * Deleting our copy of a token is not the same act as ending the customer's
   * authorisation. Without this, a workspace that has been destroyed leaves
   * "Namzilabs" sitting in the customer's Google account permissions forever —
   * we can no longer use it, and they have no way to know that, so the only
   * honest state is to say so to the provider.
   *
   * Optional because not every provider offers one. Absent means the grant can
   * only be withdrawn from the provider's own settings, which is a fact about
   * them rather than a thing to paper over.
   */
  revokeUrl?: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** The scopes to request for a given source (one provider can back several). */
  scopesFor: (source: string) => string[];
  /** Extra authorize-URL params, appended after `scope` and before `state`. */
  authParams?: Record<string, string>;
  /** "standard" = refresh_token grant at `tokenUrl`; "none" = tokens do not expire. */
  refresh: "standard" | "none";
  /** A label for the connection from the raw token response (Google: the id_token's email). */
  identity?: (raw: Record<string, unknown>) => string | undefined;
  /**
   * BUILD THE AUTHORIZE URL YOURSELF, when the standard shape does not fit.
   *
   * `buildAuthUrl` emits the OAuth 2.0 spelling — `client_id`, `response_type`,
   * `scope` — which is exactly right for Google and wrong for both of the
   * providers added next to it. TikTok's consent screen takes `app_id`, no
   * `response_type` and no `scope` at all (its scopes are fixed on the app in
   * TikTok's own portal), and returns `auth_code` rather than `code`. That is
   * not a parameter to append; it is a different URL.
   */
  authorizeUrlFor?: (p: OAuthProvider, o: { source: string; state: string; redirectUri: string; clientId: string }) => string;
  /**
   * EXCHANGE THE CODE YOURSELF, when the standard form POST does not fit.
   *
   * The shared `exchangeCode` POSTs `application/x-www-form-urlencoded` to
   * `tokenUrl`. Meta documents a **GET** with the parameters in the query
   * string, and TikTok wants a JSON body with `app_id`/`secret`/`auth_code` and
   * answers HTTP 200 with the real status in a `code` field. Neither is a
   * variation on the form POST.
   */
  exchangeCodeWith?: (
    p: OAuthProvider,
    o: { code: string; redirectUri: string; clientId: string; clientSecret: string },
  ) => Promise<OAuthTokens>;
};

const GOOGLE_SCOPES: Record<string, string[]> = {
  gsheets: ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly"],
  gcal: ["https://www.googleapis.com/auth/calendar.readonly"],
  /**
   * ONE SCOPE COVERS BOTH GA4 APIS — the Data API's reporting and the Admin
   * API's property discovery are both listed under `analytics.readonly`, so
   * asking for more would only make verification harder. The wider
   * `auth/analytics` grants WRITE access this connector never uses, and
   * Google's review asks for the narrowest scope that does the job.
   *
   * It is SENSITIVE, not restricted: it needs app verification (days), not a
   * CASA security assessment (paid, annual). Note the `drive.readonly` above
   * IS restricted, so this project is already on the heavier track and
   * Analytics rides along on it.
   */
  ganalytics: ["https://www.googleapis.com/auth/analytics.readonly"],
  /**
   * ONE SCOPE, AND IT IS THE ONLY ONE GOOGLE ADS HAS. There is no read-only
   * variant: `auth/adwords` is the whole API, reporting and mutation alike, so
   * the narrowest grant that reads a report is also one that could spend money.
   * Nothing in this connector writes — `google-ads.ts` has no mutate path at
   * all — but the CONSENT SCREEN cannot say that, and a customer reading it
   * will see "manage your AdWords campaigns". Worth knowing before support asks.
   *
   * SENSITIVE since 1 Oct 2020, so the app needs Google's OAuth verification
   * (3-5 business days, free) on top of the Cloud project's Google Ads API
   * access level, which is a separate queue with its own form. Both must land
   * before one customer can connect.
   */
  gads: ["https://www.googleapis.com/auth/adwords"],
};

function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.includes("@") ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every OAuth provider the app can send a customer to. Adding one is one
 * entry here plus its client id and secret in the environment; the start and
 * callback routes, the state cookie and token refresh are shared.
 */
export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  /**
   * META — FACEBOOK LOGIN FOR BUSINESS, NOT THE CONSUMER LOGIN.
   *
   * THE 60-DAY PROBLEM AND THE TWO WAYS OUT. A classic long-lived user token
   * lasts about 60 days and CANNOT be refreshed: Meta has no refresh_token
   * grant, and an expired token cannot be exchanged for a new one. A product
   * built on that re-authorises every customer six times a year, and the way
   * customers experience it is a dashboard that quietly stops updating.
   *
   * Meta's own documentation gives two escapes, and this entry is built to take
   * whichever is available:
   *
   *   1. "Apps with Standard access to the Marketing API receive long-lived
   *      tokens that do not expire based on time, though they are still subject
   *      to invalidation for other reasons."
   *      (developers.facebook.com/docs/facebook-login/guides/access-tokens/,
   *      read 21 Sep 2026.) That upper tier was renamed FULL ACCESS on
   *      4 May 2026 and now needs 500+ Marketing API calls in 15 days with an
   *      error rate under 15% — so the expiry problem solves itself once the
   *      app is real enough to have made 500 calls.
   *   2. A BUSINESS INTEGRATION SYSTEM USER token, which "defaults to never
   *      expire", obtained by pointing the login dialog at a saved
   *      CONFIGURATION rather than at a scope list. Set `META_LOGIN_CONFIG_ID`
   *      and this entry sends `config_id` instead of `scope`; leave it unset
   *      and it falls back to the plain `ads_read` consent screen.
   *
   * Either way the connector code is identical — it holds an access token and
   * reads insights with it. The difference is only how long the token lives,
   * which is why this is one provider entry and not two.
   */
  meta: {
    key: "meta",
    name: "Meta",
    // The dialog lives on www.facebook.com and the token endpoint on
    // graph.facebook.com. Two hosts, one flow; mixing them up 404s.
    authorizeUrl: `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
    tokenUrl: `${META_GRAPH}/oauth/access_token`,
    /**
     * NO revokeUrl, AND THAT IS A STATEMENT RATHER THAN AN OMISSION. Meta ends
     * a grant with `DELETE /{user-id}/permissions`, which is a different verb
     * against a different shape than the POST `revokeOAuthGrant` performs. A
     * wrong call here would report success while leaving Namzilabs sitting in
     * the customer's Business settings for ever, which is worse than saying
     * plainly that the grant is withdrawn from Meta's own interface.
     */
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    /**
     * `ads_read` IS ENOUGH, and asking for more would be worse than useless.
     * Meta's Marketing API access guide says to "request the ads_read
     * permission" for reading ad reports; `ads_management` additionally grants
     * the ability to CREATE AND DELETE CAMPAIGNS, which this connector never
     * does and which makes both App Review and the customer's consent screen
     * harder for nothing.
     */
    scopesFor: () => ["ads_read"],
    refresh: "none",
    authorizeUrlFor: (p, o) => {
      const params = new URLSearchParams({
        client_id: o.clientId,
        redirect_uri: o.redirectUri,
        response_type: "code",
      });
      const configId = process.env.META_LOGIN_CONFIG_ID;
      if (configId) {
        // A CONFIGURATION REPLACES THE SCOPE LIST. The permissions live on the
        // config in Meta's App Dashboard, which is also what makes the token a
        // system-user one; sending `scope` as well is how the dialog silently
        // reverts to a plain user token.
        params.set("config_id", configId);
        params.set("override_default_response_type", "true");
      } else {
        params.set("scope", p.scopesFor(o.source).join(","));
      }
      params.set("state", o.state);
      return `${p.authorizeUrl}?${params.toString()}`;
    },
    exchangeCodeWith: async (p, o) => {
      // Meta documents a GET with the parameters in the query string.
      const url = new URL(p.tokenUrl);
      url.searchParams.set("client_id", o.clientId);
      url.searchParams.set("client_secret", o.clientSecret);
      url.searchParams.set("redirect_uri", o.redirectUri);
      url.searchParams.set("code", o.code);
      const short = await fetchJson<{ access_token: string; expires_in?: number }>(url.toString());

      /**
       * IMMEDIATELY TRADE UP TO A LONG-LIVED TOKEN.
       *
       * The code exchange yields a token measured in HOURS. Without this step
       * every Meta connection would break the same afternoon it was made — the
       * single most consequential line in this entry, and the one with no
       * visible symptom until the next sweep.
       *
       * ATTEMPTED, NOT REQUIRED. A Business Integration System User token is
       * already long-lived and Meta may refuse to exchange it; refusing to
       * connect over a step that was unnecessary would break the better of the
       * two paths. So a failure keeps the token we already hold.
       */
      let accessToken = short.access_token;
      let expiresIn = short.expires_in ?? 3600;
      try {
        const ex = new URL(p.tokenUrl);
        ex.searchParams.set("grant_type", "fb_exchange_token");
        ex.searchParams.set("client_id", o.clientId);
        ex.searchParams.set("client_secret", o.clientSecret);
        ex.searchParams.set("fb_exchange_token", accessToken);
        const long = await fetchJson<{ access_token?: string; expires_in?: number }>(ex.toString());
        if (long.access_token) {
          accessToken = long.access_token;
          // NO `expires_in` MEANS NO EXPIRY, which is what a Full-Access app and
          // a system-user token both return. Recorded as a decade out so the
          // refresh check in `getConnectionCredentials` never fires on it.
          expiresIn = long.expires_in ?? 10 * 365 * 86_400;
        }
      } catch {
        // Keep the short-lived token; the connection still works today and the
        // prober is what reports that the trade-up is failing.
      }
      return { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    },
  },

  /**
   * TIKTOK — THE MARKETING API's ADVERTISER AUTHORISATION.
   *
   * ALMOST NOTHING ABOUT THIS IS STANDARD OAUTH. The consent screen is at
   * `/portal/auth` and takes `app_id` rather than `client_id`, sends no
   * `response_type` and no `scope` (an app's scopes are fixed in TikTok's
   * developer portal, not requested per call), and returns the grant as
   * `auth_code` rather than `code`. The token endpoint is a JSON POST that
   * answers HTTP 200 whether it worked or not. Hence both hooks.
   *
   * `refresh: "none"` IS THE CLAIM MOST WORTH DOUBTING HERE. Advertiser tokens
   * are widely reported not to expire, and TikTok's access-token response for
   * this flow carries no `expires_in` — but TikTok's docs portal renders
   * client-side and cannot be read by any fetcher, so this rests on secondary
   * sources. `scripts/verify-tiktok-ads.ts` is what settles it; until it has
   * run, treat the lifetime as unknown rather than as infinite.
   */
  tiktok: {
    key: "tiktok",
    name: "TikTok",
    authorizeUrl: "https://business-api.tiktok.com/portal/auth",
    tokenUrl: `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}/oauth2/access_token/`,
    clientIdEnv: "TIKTOK_APP_ID",
    clientSecretEnv: "TIKTOK_APP_SECRET",
    scopesFor: () => [],
    refresh: "none",
    authorizeUrlFor: (p, o) =>
      `${p.authorizeUrl}?${new URLSearchParams({
        app_id: o.clientId,
        redirect_uri: o.redirectUri,
        state: o.state,
      }).toString()}`,
    exchangeCodeWith: async (p, o) => {
      const res = await fetchJson<{
        code?: number;
        message?: string;
        data?: { access_token?: string; advertiser_ids?: string[] };
      }>(p.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: o.clientId, secret: o.clientSecret, auth_code: o.code }),
      });
      // A 200 with a non-zero code is the failure mode; without this check a
      // refused authorisation would be stored as a connection holding
      // `undefined` and fail on every sweep instead of at the moment it broke.
      if ((res.code ?? -1) !== 0 || !res.data?.access_token) {
        throw new Error(`TikTok refused the authorisation (${res.code ?? "no code"}: ${res.message ?? "no message"}).`);
      }
      return {
        accessToken: res.data.access_token,
        // No expiry is returned for this flow; see the note above.
        expiresAt: Date.now() + 10 * 365 * 86_400 * 1000,
      };
    },
  },

  google: {
    key: "google",
    name: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopesFor: (source) => ["openid", "email", ...(GOOGLE_SCOPES[source] ?? [])],
    authParams: { access_type: "offline", include_granted_scopes: "true", prompt: "consent select_account" },
    refresh: "standard",
    identity: (raw) => emailFromIdToken(raw["id_token"]),
  },
};

export function oauthProvider(key: string | null | undefined): OAuthProvider | undefined {
  return key ? OAUTH_PROVIDERS[key] : undefined;
}

/** The provider a source authenticates through, from its catalog entry. */
export function oauthProviderFor(source: string | null | undefined): OAuthProvider | undefined {
  const entry = catalogEntry(source ?? "");
  if (!entry) return undefined;
  if (entry.connect === "google") return OAUTH_PROVIDERS.google;
  if (entry.connect === "oauth") return oauthProvider(entry.oauthProvider);
  return undefined;
}

/**
 * Can this source actually be connected on this deployment?
 *
 * FALSE IS A NORMAL STATE, not a misconfiguration to alarm about: a connector
 * lands in the catalogue the moment its code is written, and the app
 * registration behind it can take weeks — Google Ads needs a developer token
 * and an OAuth verification at two different queues. Until then the card must
 * say so rather than offering a button that throws.
 */
export function sourceConnectable(source: string): boolean {
  const entry = catalogEntry(source);
  // Switched off by the owner: never connectable, whatever the env holds.
  if (!entry || entry.off) return false;
  for (const name of entry.requiresEnv ?? []) if (!process.env[name]) return false;
  const provider = oauthProviderFor(source);
  if (!provider) return true; // paste-a-key sources need nothing of ours
  return !!process.env[provider.clientIdEnv] && !!process.env[provider.clientSecretEnv];
}
