/**
 * Postgres' "undefined_table" (SQLSTATE 42P01), however the driver hands it
 * back: a direct `pg` client puts the code on the error itself, but the http
 * driver some deployments use wraps the original error under `.cause` and can
 * lose the code along the way — so the message text is checked too, but
 * narrowly: `/relation .* does not exist/i`, never a bare `/does not exist/i`,
 * which would also match "column ... does not exist" or "function ... does
 * not exist" — a real query bug wearing the same words, silently reported as
 * "not migrated yet" instead of surfacing as the bug it is.
 *
 * WHY IT IS SHARED. Every migration here is pasted by hand (drizzle/HAND_APPLY.md),
 * so code can reach production before the table it writes to. A feature that
 * adds a TABLE — never a column on an existing one — can survive that window by
 * treating exactly this error as "not switched on yet". The MCP prune was the
 * first to need it; workspace templates and workspace deletion are the next.
 */
export function isUndefinedTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  if (err.code === "42P01" || err.cause?.code === "42P01") return true;
  const message = `${typeof err.message === "string" ? err.message : ""} ${typeof err.cause?.message === "string" ? err.cause.message : ""}`;
  return /relation .* does not exist/i.test(message);
}
