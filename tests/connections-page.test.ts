import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * C22 — Whop showed "Latest records" and then failed every click with the
 * webhook-only message. `isStreamScoped` alone says nothing about whether the
 * connector actually implements `testFetchLatest` — Whop is connection-scoped
 * (so the old gate showed the section) but has no preview implementation at
 * all (so every click threw).
 *
 * Source-text pinned, the same way `connection-delete-ui.test.ts` pins a
 * structural fact about `ConnectionRow.tsx` and `timeout-budgets.test.ts`
 * pins a declaration in this exact file: `ConnectionPage` is an async server
 * component that calls `requireOrg()` and reads the database directly, so
 * rendering it here would mean rebuilding most of its data layer as mocks to
 * check one conditional. Reading the gate off the file is the honest trade.
 */

const SRC_PATH = "src/app/connections/[id]/page.tsx";

describe("the Latest records section gate (C22)", () => {
  const src = readFileSync(SRC_PATH, "utf8");

  it("imports getConnector, so the gate can check testFetchLatest", () => {
    expect(src).toContain('import { getConnector } from "@/connectors/registry";');
  });

  it("gates on testFetchLatest as well as on stream scope", () => {
    // Sabotage: revert to `{!isStreamScoped(conn.source) && (` alone and a
    // poll-only, connection-scoped source with no preview implementation
    // (Whop today) shows "Preview latest" and fails on every click.
    const idx = src.indexOf("{!isStreamScoped(conn.source)");
    expect(idx, "the Latest records gate was not found where expected").toBeGreaterThan(-1);
    const line = src.slice(idx, src.indexOf("\n", idx));
    expect(line).toContain("getConnector(conn.source)?.testFetchLatest");
  });
});
