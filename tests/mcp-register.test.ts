import { describe, it, expect, vi } from "vitest";
import type { z } from "zod";

// register.ts -> tools/workspaces.ts -> context.ts -> workspace.ts reaches
// `@workos-inc/authkit-nextjs` and `@/db/client` at import time, even though
// this file never calls a handler (it only inspects what `registerTool` was
// called with). Mocked purely so the import graph resolves under Vitest, same
// as tests/mcp-context.test.ts / tests/mcp-route.test.ts.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  getWorkOS: () => ({ userManagement: { listOrganizationMemberships: async () => ({ data: [] }) }, organizations: { getOrganization: async (id: string) => ({ id, name: `Org ${id}` }) } }),
}));
vi.mock("@/db/client", () => ({ getDb: () => ({}), getReadDb: () => ({}) }));

import { registerNamzilabsTools, TOOLS, READ_ONLY } from "@/lib/mcp/register";
import { PROVENANCE_SENTENCE } from "@/lib/mcp/result";

type Registered = { name: string; config: Record<string, unknown>; handler: unknown };

describe("registerNamzilabsTools", () => {
  it("registers every listed tool, read-only, with provenance in its description, a strict input schema, and no output schema for the SDK to enforce", () => {
    const registered: Registered[] = [];
    const fake = { registerTool: (name: string, config: Record<string, unknown>, handler: unknown) => { registered.push({ name, config, handler }); } };

    registerNamzilabsTools(fake);

    expect(registered).toHaveLength(TOOLS.length);
    expect(registered.map((r) => r.name)).toEqual(TOOLS.map((t) => t.name));

    for (const { config } of registered) {
      expect(config.annotations).toEqual(READ_ONLY);
      expect(typeof config.description).toBe("string");
      expect((config.description as string).endsWith(PROVENANCE_SENTENCE)).toBe(true);

      // RULING (Tasks 6-7 review): the SDK validates every non-error result
      // against a declared outputSchema, and the deliberate `workspace_required`
      // escape-hatch shape can never satisfy either tool's real success shape —
      // so the registry must never hand outputSchema to the SDK, even though
      // the tool objects keep it for documentation.
      expect("outputSchema" in config).toBe(false);

      const rejected = (config.inputSchema as z.ZodTypeAny).safeParse({ notAField: true });
      expect(rejected.success).toBe(false);
    }
  });
});
