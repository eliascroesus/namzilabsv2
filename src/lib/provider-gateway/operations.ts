import { getConnector } from "@/connectors/registry";

/**
 * Resolve which provider endpoint a poll will hit, as the `"resource.verb"` key
 * the budget claims against.
 *
 * This exists because the budget layer was, until now, only half-wired. Budgets
 * have always been stored and enforced per `(connection, operation)` — the
 * usage_ledger's unique key is `(connection_id, operation, window_start)` and
 * `budgetFor` reads `rateLimits[operation]` — but every production call site
 * passed the literal `"*"`. So a connector could declare
 * `emails.list: 20/min`, have it verified by a unit test, and still spend at
 * the `"*"` fallback of 60/min × 0.7 = 42/min against a 20/min endpoint. The
 * declaration was real, the enforcement was not.
 *
 * Resolution happens from the CONFIG, before the call — a budget you can only
 * check after spending the call is not a budget.
 *
 * `"*"` remains the honest answer for a connector whose provider publishes one
 * account-wide limit: it is a real shared bucket, not a fallback.
 */
export function pollOperation(source: string, config?: Record<string, unknown> | null): string {
  return getConnector(source)?.operationFor?.(config ?? undefined) ?? "*";
}
