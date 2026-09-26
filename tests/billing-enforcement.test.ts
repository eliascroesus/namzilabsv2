import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createTestDb, seedConnection } from "./helpers/testdb";
import type { DB } from "@/db/types";

/**
 * THE LIMITS ARE ENFORCED WHERE THINGS ARE CREATED — not in the UI.
 *
 * One real path end to end (connecting an app, through the single writer every
 * connect route shares), and a syntax-tree check that every other entry point
 * calls its limit inside the function that does the creating — so a new
 * shortcut that skips the check fails here rather than in someone's invoice.
 */

let db: DB;
let close: () => Promise<void>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => db, getReadDb: () => db }));
vi.mock("@/inngest/client", () => ({ inngest: { send: async () => {} } }));

const { createConnection } = await import("@/lib/connections");
const { PlanLimitError } = await import("@/lib/billing/limits");

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

describe("connecting an app", () => {
  const connect = () => createConnection({ orgId: "org_e", source: "webhook", name: "one more", authType: "secret" });

  it("is refused past the plan's apps with billing on", async () => {
    vi.stubEnv("BILLING_ENABLED", "1");
    for (let i = 0; i < 3; i++) await seedConnection(db, { orgId: "org_e", source: "webhook" });
    await expect(connect()).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("is allowed as before with billing off", async () => {
    vi.stubEnv("BILLING_ENABLED", "");
    for (let i = 0; i < 3; i++) await seedConnection(db, { orgId: "org_e", source: "webhook" });
    await expect(connect()).resolves.toMatchObject({ orgId: "org_e" });
  });
});

/** The text of one named function (declaration, `const x = async () =>`, or an exported route handler). */
function bodyOf(file: string, name: string, source = readFileSync(file, "utf8")): string | null {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found: string | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n.getText(sf);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) found = n.initializer.getText(sf);
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

const ENTRY_POINTS: Array<[file: string, fn: string, mustCall: string[]]> = [
  ["src/lib/connections.ts", "createConnection", ["assertCanAddApp("]],
  ["src/app/api/oauth/[provider]/start/route.ts", "GET", ["assertCanAddApp(", "upgradeHref("]],
  ["src/app/api/oauth/[provider]/callback/route.ts", "GET", ["PlanLimitError", "upgradeHref("]],
  ["src/app/integrations/actions.ts", "connectApiKeyAction", ["PlanLimitError", "upgradeHref("]],
  ["src/app/dashboard/flows/actions.ts", "publishFlowAction", ["assertCanPublish("]],
  ["src/app/dashboard/settings/actions.ts", "inviteMemberAction", ["assertCanInvite("]],
  ["src/app/dashboard/settings/template-actions.ts", "createTemplateAction", ["assertFeature(", '"shareTemplates"']],
  ["src/app/dashboard/settings/template-actions.ts", "updateTemplateAction", ["assertFeature(", '"shareTemplates"']],
  ["src/lib/mcp/context.ts", "withToolContext", ["assertFeature(", '"aiAssistant"']],
];

describe("publishing with billing off", () => {
  it("reads nothing for the plan check unless billing is on, and never lets that read throw to the builder", () => {
    // The builder awaits publishFlowAction with no catch: a throw leaves
    // Publish spinning on "Publishing…". The plan check's draft read must sit
    // behind the flag AND inside a try that turns any failure into an answer.
    const body = bodyOf("src/app/dashboard/flows/actions.ts", "publishFlowAction")!;
    const gate = body.indexOf("billingEnabled()");
    const read = body.indexOf("getFlow(");
    expect(gate, "the plan check is not behind the flag").toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(gate);
    expect(body.slice(gate, read), "the draft read is outside the try").toContain("try {");
  });
});

describe("every entry point checks its limit inside the function that creates", () => {
  it("the check can fail: a function without the call is caught", () => {
    const body = bodyOf("fixture.ts", "make", "export async function make() { await createThing(); }\nexport async function other() { await assertCanAddApp(db, o); }");
    expect(body).not.toBeNull();
    expect(body).not.toContain("assertCanAddApp(");
  });

  it.each(ENTRY_POINTS)("%s — %s", (file, fn, mustCall) => {
    const body = bodyOf(file, fn);
    expect(body, `${fn} not found in ${file}`).not.toBeNull();
    for (const call of mustCall) expect(body, `${fn} must contain ${call}`).toContain(call);
  });
});
