/**
 * Human wording for every `?error=` code a redirect can land on /integrations
 * with. The OAuth callback has redirected here with three distinct codes
 * since it shipped — and this page rendered NONE of them: a user whose Google
 * connection failed was bounced back to a normal-looking integrations page
 * with a query string and no explanation, indistinguishable from success
 * minus the connection they expected to see.
 *
 * A test parses the callback route's source for `error=` codes and asserts
 * every one has copy here, so a new redirect code cannot ship silent again.
 *
 * Never echo a raw code as prose — the page renders it small, in parentheses,
 * for support conversations.
 */
export function integrationsErrorMessage(code: string): string {
  switch (code) {
    case "state_mismatch":
      return "That connection attempt expired or didn't match the one we started. Nothing was connected — please try again.";
    case "oauth_denied":
      return "Google access was declined, so nothing was connected.";
    case "oauth_exchange":
      return "Google didn't complete the authorization. Nothing was connected — please try again.";
    case "connection_limit":
      return "This workspace has reached its connection limit, so nothing was connected. Contact us and we'll raise it.";
    default:
      return "Something went wrong connecting that account. Nothing was connected — please try again.";
  }
}
