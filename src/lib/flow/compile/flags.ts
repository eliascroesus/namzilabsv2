/**
 * E.4 rollout flags for the compiled pushdown — the DB_DRIVER two-flag
 * pattern (src/db/client.ts): the read-only surface soaks first, the
 * number-producing surface flips only after, and either reverts instantly by
 * unsetting an env var. Both default OFF, which keeps today's behavior
 * byte-identical until an operator decides otherwise.
 *
 *  - ENGINE_COMPILE_TEST="1" — compile on the TEST surface only (node Tests,
 *    which a human is watching and which persist nothing). The soak seam.
 *  - ENGINE_COMPILE="1"      — compile everywhere, including materialization
 *    (the numbers customers see).
 *
 * Why this is safe to offer at all: the pushdown is a PRE-filter — the JS
 * engine re-applies every folded rule (engine.ts), so a compiler bug can
 * cost extra work, never a wrong answer — and the legacy-row divergence that
 * originally gated it (engine-parity.test.ts proves pre-normalization rows
 * disagree even on `equals`) is moot for all current data: checklist item 5
 * is "DONE BY WIPE (2026-07-29)", and every row written since is normalized
 * at ingest. Checklist 9b's per-flow flag remains the finer-grained
 * successor, post-launch.
 */
export function compileEnabled(surface: "test" | "materialize"): boolean {
  if (process.env.ENGINE_COMPILE === "1") return true;
  return surface === "test" && process.env.ENGINE_COMPILE_TEST === "1";
}
