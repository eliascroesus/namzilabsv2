import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    // Everywhere this code actually runs is UTC — Vercel functions and CI
    // both. A developer machine on UTC+2 made a timezone-dependent assertion
    // fail locally while green in CI (`parseDate`'s loose path reads a
    // zone-less "2026-07-22 10:30:00" as LOCAL time, the strict path as UTC,
    // and the parse-drift watcher rightly reported the divergence). Tests run
    // in the timezone production runs in.
    env: { TZ: "UTC" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
