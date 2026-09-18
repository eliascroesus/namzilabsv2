/**
 * BUILD IT, SERVE IT, CHECK THE THING THAT ACTUALLY DEPLOYS.
 *
 * WHY THIS EXISTS. `pnpm landing` points at the dev server, and the dev server
 * is not what ships. A page can typecheck, pass every test, compile under
 * `next build`, render perfectly under `next dev` — and still deploy with a
 * stylesheet from a previous build, which is exactly what happened to the
 * landing rebuild. "The build compiled" and "the built page renders" are two
 * different claims and I had been reporting the first as though it were the
 * second.
 *
 * So: a real production build, served by `next start`, measured by the same
 * checker, torn down afterwards. It is slower than `pnpm landing` and it is
 * the one to run before saying a page is done.
 *
 * It does NOT catch a stale asset on the CDN — nothing local can. For that,
 * point the checker at the deployed origin after a deploy:
 *
 *   SHOT_BASE=https://namzilabs.co pnpm landing
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.PREVIEW_PORT ?? "3210";
const BASE = `http://localhost:${PORT}`;

/** Run a command to completion, inheriting stdio, and resolve its exit code. */
const run = (cmd, args, env) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
    p.on("exit", (code) => resolve(code ?? 1));
  });

console.log("▸ building");
if ((await run("pnpm", ["build"])) !== 0) {
  console.error("\n✗ build failed — nothing to preview");
  process.exit(1);
}

console.log(`\n▸ serving the production build on ${BASE}`);
const server = spawn("pnpm", ["start"], {
  env: { ...process.env, PORT },
  stdio: ["ignore", "pipe", "pipe"],
});

/* Poll rather than sleep a fixed amount: a cold start on a laptop and a warm
   one differ by several seconds, and a fixed wait is either flaky or slow. */
let up = false;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(2_000) });
    if (res.ok) {
      up = true;
      break;
    }
  } catch {
    /* not listening yet */
  }
}

let code = 1;
if (!up) {
  console.error(`✗ the production server never answered on ${BASE}`);
} else {
  console.log("▸ checking the built output\n");
  code = await run("node", ["scripts/landing-check.mjs"], { SHOT_BASE: BASE });
}

server.kill("SIGTERM");
/* `next start` spawns workers; give them a moment, then insist. */
await sleep(600);
if (!server.killed) server.kill("SIGKILL");

process.exit(code);
