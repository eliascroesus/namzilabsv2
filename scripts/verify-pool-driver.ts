/**
 * HUMAN-RUN verification that the Neon `pool` driver delivers the session
 * semantics C.1 depends on (PRE_LAUNCH_CHECKLIST.md item 4d): interactive
 * transactions (commit + rollback) and advisory locks that actually contend
 * across connections.
 *
 *   DATABASE_URL="postgresql://…" DB_DRIVER=pool pnpm tsx scripts/verify-pool-driver.ts
 *
 * Uses a throwaway temp table; leaves nothing behind. Exits 0 on full PASS.
 */
import { Pool } from "@neondatabase/serverless";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL and re-run.");
    process.exit(2);
  }
  console.log("Pool-driver capability verification\n");
  const pool = new Pool({ connectionString: url });
  const table = `_verify_pool_${Date.now()}`;

  try {
    // Transactions: commit persists, rollback erases.
    const a = await pool.connect();
    try {
      await a.query(`create temp table ${table} (id int)`);
      await a.query("begin");
      await a.query(`insert into ${table} values (1)`);
      await a.query("commit");
      const afterCommit = await a.query(`select count(*)::int as n from ${table}`);
      check("transaction commit persists", afterCommit.rows[0].n === 1);

      await a.query("begin");
      await a.query(`insert into ${table} values (2)`);
      await a.query("rollback");
      const afterRollback = await a.query(`select count(*)::int as n from ${table}`);
      check("transaction rollback erases", afterRollback.rows[0].n === 1);

      // Advisory locks: a second connection must NOT get the lock while held.
      const b = await pool.connect();
      try {
        await a.query("begin");
        const got = await a.query("select pg_try_advisory_xact_lock(42424242) as ok");
        check("advisory lock acquired (conn A)", got.rows[0].ok === true);

        const contested = await b.query("select pg_try_advisory_xact_lock(42424242) as ok");
        check("advisory lock CONTENDS across connections (conn B refused)", contested.rows[0].ok === false);

        await a.query("commit"); // xact lock releases with the transaction
        const after = await b.query("select pg_try_advisory_xact_lock(42424242) as ok");
        check("lock released on commit (conn B acquires)", after.rows[0].ok === true);
        await b.query("select pg_advisory_unlock_all()");

        // Q6: the Test path's bounded BLOCKING wait — while A holds the lock,
        // B's blocking acquire must respect lock_timeout instead of hanging.
        await a.query("begin");
        await a.query("select pg_advisory_xact_lock(52525252)");
        await b.query("begin");
        await b.query("set local lock_timeout = 300");
        let timedOut = false;
        try {
          await b.query("select pg_advisory_xact_lock(52525252)");
        } catch {
          timedOut = true;
        }
        await b.query("rollback");
        check("bounded blocking wait times out while held (Q6 await path)", timedOut);
        await a.query("commit");
        await b.query("begin");
        await b.query("set local lock_timeout = 300");
        let acquiredAfterRelease = true;
        try {
          await b.query("select pg_advisory_xact_lock(52525252)");
        } catch {
          acquiredAfterRelease = false;
        }
        await b.query("commit");
        check("blocking wait acquires once released (Q6 await path)", acquiredAfterRelease);
      } finally {
        b.release();
      }
    } finally {
      a.release();
    }
  } finally {
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\nPool driver verified — safe to keep DB_DRIVER=pool; C.1 critical sections are effective."
      : `\n${failures.length} check(s) FAILED: ${failures.join("; ")}\n→ Revert DB_DRIVER to http. Most common cause: DATABASE_URL points at a transaction-mode pooler that breaks session semantics — use the direct (non "-pooler") Neon host for the pool driver.`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nAborted: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
