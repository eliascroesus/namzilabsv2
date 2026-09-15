import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@/db/schema";
import { DESTROYED_ORG_TABLES } from "@/lib/destroy";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every table the schema declares, with the columns it carries. */
function declared(): Array<{ name: string; cols: string[] }> {
  const out: Array<{ name: string; cols: string[] }> = [];
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== "object") continue;
    const nameSym = Object.getOwnPropertySymbols(value).find((s) => s.toString() === "Symbol(drizzle:Name)");
    if (!nameSym) continue;
    out.push({ name: (value as unknown as Record<symbol, string>)[nameSym], cols: Object.keys(value) });
  }
  return out;
}

/**
 * DELETING A WORKSPACE, AND DELETING A PERSON.
 *
 * The failure mode of this feature is NOT a crash. It is a table quietly left
 * behind, holding a customer's data after they were told it was gone — which
 * nothing in the product would ever surface, and which the customer has no way
 * to check. So the assertion that matters most is the boring one: every
 * tenant-scoped table is in the list.
 */
/**
 * THE ONE TENANT TABLE A DELETION DELIBERATELY DOES NOT TOUCH, with its reason
 * attached — so it is a decision in a diff rather than a table somebody forgot.
 *
 * Every other entry in this file exists to prove that a workspace's data really
 * goes. This is the exception, and it is the exception the feature requires:
 * the product has a one-click irreversible workspace delete, and deleting the
 * workspace to destroy the record of what was done inside it is the obvious
 * move for anybody who has just done something they should not have. An audit
 * log the audited act erases cannot answer the one question it exists for.
 *
 * WHAT MAKES IT DEFENSIBLE IS ENFORCED SEPARATELY, in `tests/audit.test.ts`:
 * no email, no name, no credential, no customer record and no free text ever
 * reaches `audit_log`, so what survives a deletion is our record of an ACT —
 * opaque ids, an action name from a closed list, counts — and never the
 * customer's data. If that invariant ever breaks, this exemption becomes
 * indefensible, which is why the two are tested in the same suite run.
 */
const SURVIVES_DELETION: Record<string, string> = {
  audit_log:
    "the governance audit trail must outlive the workspace it describes, or deleting a workspace erases the " +
    "record of who deleted it. Holds no personal data and no user content — see tests/audit.test.ts, which " +
    "is what keeps that true.",
};

describe("a workspace deletion reaches every table", () => {
  it("covers every table in the schema that carries an org_id", () => {
    /**
     * WALKS THE SCHEMA rather than naming tables here, because a list of names
     * in a test is the same list as the one in the code and would go stale in
     * the same commit. Add a tenant table and this fails until `destroy.ts`
     * knows about it.
     */
    const orgScoped = declared()
      .filter((t) => t.cols.includes("orgId"))
      .map((t) => t.name)
      .sort();
    const missing = orgScoped.filter((t) => !DESTROYED_ORG_TABLES.includes(t) && !SURVIVES_DELETION[t]);
    expect(
      missing,
      `Tenant table(s) a workspace delete would leave behind: ${missing.join(", ")}. ` +
        `Add each to ORG_TABLES in src/lib/destroy.ts, in child-before-parent order.`,
    ).toEqual([]);
  });

  it("every table exempted from deletion states a real reason", () => {
    /**
     * The same guard `retention-coverage.test.ts` puts on its gap list, for the
     * same reason: an exemption map with a one-word reason is a rubber stamp,
     * and "this table survives a customer's deletion request" is the last
     * sentence in this codebase that should be allowed to go unexplained.
     */
    for (const [table, reason] of Object.entries(SURVIVES_DELETION)) {
      expect(declared().map((t) => t.name), `${table} is exempted but is not a table`).toContain(table);
      expect(reason.trim().split(/\s+/).length, `${table}'s exemption needs a real reason`).toBeGreaterThan(12);
      // An exemption for a table the sweep ALSO clears is a contradiction: one
      // of the two is wrong and a reader cannot tell which.
      expect(DESTROYED_ORG_TABLES, `${table} is both exempted and swept`).not.toContain(table);
    }
  });

  it("names nothing that is not a table any more", () => {
    const all = declared().map((t) => t.name);
    const stale = DESTROYED_ORG_TABLES.filter((t) => !all.includes(t));
    expect(stale, `Listed for deletion but gone from the schema: ${stale.join(", ")}`).toEqual([]);
  });

  it("deletes children before their parents", () => {
    /**
     * Most of these cascade, and relying on that makes the order load-bearing
     * the day somebody drops an `on delete` clause. The four pairs below are
     * the ones with a real foreign key between them.
     */
    const at = (t: string) => DESTROYED_ORG_TABLES.indexOf(t);
    for (const [child, parent] of [
      ["dashboard_tile_placements", "dashboard_views"],
      ["dashboard_tiles", "dashboard_views"],
      ["flow_results", "flows"],
      ["flow_versions", "flows"],
      ["rank_assignments", "workspace_ranks"],
    ] as const) {
      expect(at(child), `${child} must be deleted before ${parent}`).toBeLessThan(at(parent));
    }
  });

  it("handles the one table no org_id can reach", () => {
    /**
     * `sync_state` is keyed by `connection_id` with NO foreign key, so a
     * connection delete orphans its cursor instead of removing it — and there
     * is no `org_id` on it to sweep by. It is collected from the connections
     * read, which is why that read happens BEFORE anything is deleted.
     */
    const src = code(read("src/lib/destroy.ts"));
    expect(src).toMatch(/inArray\(syncState\.connectionId/);
    const readAt = src.indexOf("const conns = await db");
    /* THE CALL, NOT THE IMPORT. `indexOf("deleteConnectionData")` found the
       import at the top of the file and compared the read against that —
       which is always earlier, so the assertion could only ever fail. */
    const deleteAt = src.indexOf("deleteConnectionData(db,");
    expect(readAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(readAt, "the connection ids are read before anything is deleted").toBeLessThan(deleteAt);
  });

  it("destroys connections through the path that tears their webhooks down", () => {
    /**
     * A bare `delete from connections` would leave Calendly and Close retrying
     * a URL our webhook route now 403s, forever. `deleteConnectionData` asks
     * each provider to stop first — best-effort, never blocking.
     */
    expect(code(read("src/lib/destroy.ts"))).toMatch(/deleteConnectionData\(db, orgId, c\.id, c\.name\)/);
  });
});

describe("who may destroy what", () => {
  const actions = code(read("src/app/dashboard/settings/danger-actions.ts"));
  const body = (name: string) => {
    const start = actions.indexOf(`export async function ${name}`);
    expect(start, `${name} is gone`).toBeGreaterThan(-1);
    const rest = actions.slice(start);
    const end = rest.indexOf("\nexport ", 1);
    return end === -1 ? rest : rest.slice(0, end);
  };

  it("takes the workspace from the SESSION, never from a form", () => {
    /**
     * A server action is a public endpoint whatever page is drawing it. An
     * `organizationId` field on a DELETE would let anybody destroy any
     * workspace whose id they could guess.
     */
    for (const name of ["transferOwnershipAction", "deleteWorkspaceAction"]) {
      expect(body(name), name).toMatch(/await requireOrg\(\)/);
      expect(body(name), name).not.toContain('formData.get("organizationId")');
    }
    // The ONE id read from a form is the transfer target, and it is walled by a
    // membership check before it is used.
    expect(body("transferOwnershipAction")).toMatch(/listOrganizationMemberships/);
    expect(body("transferOwnershipAction")).toMatch(/members\.some\(\(m\) => m\.userId === target\)/);
  });

  it("is OWNER-only, not `canManageRanks`", () => {
    /**
     * That gate is right for inviting people and assigning roles, and wrong
     * here: an admin who may govern a workspace may not END it, and may
     * certainly not hand it to somebody else.
     */
    expect(actions).toMatch(/workspaceOwners/);
    expect(actions, "governance is not ownership").not.toMatch(/canManageRanks/);
    for (const name of ["transferOwnershipAction", "deleteWorkspaceAction"]) {
      expect(body(name), name).toMatch(/isOwner\(orgId, userId\)/);
    }
  });

  it("requires the name typed back, on the server", () => {
    // Part of the CONTRACT, not a courtesy in the browser: no path — a form, a
    // script, a future admin tool — may destroy something without having
    // established WHICH thing.
    expect(body("deleteWorkspaceAction")).toMatch(/typed !== org!\.name\.trim\(\)/);
    expect(body("deleteAccountAction")).toMatch(/typed\.toLowerCase\(\) !== \(auth\.user\.email \?\? ""\)/);
  });

  it("destroys OUR data before WorkOS's, in every one of them", () => {
    /**
     * The WorkOS call cannot be undone and cannot be retried against a user or
     * org that no longer exists. If our sweep fails halfway the workspace still
     * exists and the button can be pressed again; if WorkOS went first, the
     * customer would be locked out of a tenant still holding all their data.
     */
    const w = body("deleteWorkspaceAction");
    expect(w.indexOf("destroyWorkspaceData")).toBeLessThan(w.indexOf("deleteOrganization"));

    const a = body("deleteAccountAction");
    expect(a.indexOf("destroyWorkspaceData")).toBeLessThan(a.indexOf("deleteUser"));
    expect(a.indexOf("destroyUserData")).toBeLessThan(a.indexOf("deleteUser"));
  });

  it("moves the session off an org it just deleted", () => {
    // The session still names a tenant that is gone, and every authenticated
    // route would throw on it.
    expect(body("deleteWorkspaceAction")).toMatch(/switchToOrganization|redirect\("\/onboarding"\)/);
  });

  it("takes owned workspaces with the account, and leaves the others standing", () => {
    // The owner's instruction, in their words. The membership of somebody
    // else's workspace goes; the workspace does not.
    const a = body("deleteAccountAction");
    expect(a).toMatch(/if \(await isOwner\(m\.organizationId, userId\)\)/);
    expect(a).toMatch(/deleteOrganization\(m\.organizationId\)/);
    expect(a).toMatch(/deleteOrganizationMembership\(m\.id\)/);
  });

  it("ends the session when the user behind it is gone", () => {
    expect(body("deleteAccountAction")).toMatch(/signOut\(/);
  });
});

describe("what the person is told before they press it", () => {
  it("names the workspaces an account deletion would take", () => {
    /**
     * "Workspaces you own will be deleted" is a sentence people read past. The
     * list is the one thing that makes somebody stop and check — and this is
     * the only consequence in the product that reaches OTHER people.
     */
    const ui = read("src/app/dashboard/profile/DeleteAccount.tsx");
    expect(ui).toMatch(/ownedWorkspaces\.join\(", "\)/);
    expect(ui).toMatch(/for everyone in (it|them)/);
  });

  it("puts both destructive acts behind a disclosure and a typed name", () => {
    const dz = read("src/app/dashboard/settings/DangerZone.tsx");
    expect(dz).toMatch(/<details/);
    expect(dz).toMatch(/disabled=\{!matches\}/);
    expect(dz).toMatch(/variant="destructive"/);
  });

  it("offers the zone only to the owner", () => {
    // Courtesy, not the gate — but a control advertising something the product
    // will refuse is the pattern `ViewTab` already rules out.
    expect(read("src/app/dashboard/settings/page.tsx")).toMatch(/userId === ownerUserId && workspaceName && \(/);
  });
});

/**
 * DELETION AS A SECURITY PROPERTY, not just a feature.
 *
 * "We deal with data" is the whole argument: what this product holds is other
 * people's customer records, pulled out of their CRM and their calendar, plus
 * the encrypted credentials that can fetch more. A delete that leaves any of
 * that reachable is not a bug in a feature, it is a breach with a delay on it.
 */
describe("deleting is a security act", () => {
  const destroy = code(read("src/lib/destroy.ts"));
  const conn = code(read("src/lib/sync/delete-connection.ts"));

  it("hard-deletes, never soft-deletes", () => {
    /**
     * This schema has a soft-delete idiom — `deleted_at` on events, `disabled_at`
     * on connections — and it exists so a RECONNECT can restore what a
     * disconnect hid. Reaching for it here would mean a customer told their data
     * was gone while every row was still sitting there, tombstoned.
     */
    expect(destroy).not.toMatch(/deletedAt|disabledAt|\.update\(/);
    expect(destroy).toMatch(/db\.delete\(/);
  });

  it("takes the encrypted credentials with the connection row", () => {
    // `credentials_encrypted` and `signing_secret_encrypted` are columns ON
    // `connections`, so the row going is the secret going — as long as the row
    // actually goes, which is what this pins.
    expect(conn).toMatch(/db\.delete\(connections\)/);
    expect(read("src/db/schema.ts")).toMatch(/credentialsEncrypted: text\("credentials_encrypted"\)/);
  });

  it("hands the OAuth grant back rather than only dropping our copy of it", () => {
    /**
     * THE ONE THAT WAS MISSING. Deleting an encrypted token removes OUR ability
     * to use it and does nothing about the AUTHORISATION: the customer's Google
     * account would go on listing Namzilabs among the apps that can read their
     * spreadsheets, indefinitely, for a workspace that no longer exists.
     */
    expect(conn).toMatch(/revokeProviderGrant\(db, conn\)/);
    expect(code(read("src/lib/oauth/flow.ts"))).toMatch(/export async function revokeOAuthGrant/);
    expect(read("src/lib/oauth/providers.ts")).toMatch(/revokeUrl: "https:\/\/oauth2\.googleapis\.com\/revoke"/);
  });

  it("revokes AFTER the webhook teardown, not before", () => {
    // Revocation invalidates the token the teardown authenticates with, so the
    // other order would make one of two best-effort calls fail every time.
    expect(conn.indexOf("unregisterProviderWebhook(db, conn)")).toBeLessThan(conn.indexOf("revokeProviderGrant(db, conn)"));
  });

  it("logs counts and ids, never contents", () => {
    /**
     * The one place this code could leak what it is deleting. Row counts and an
     * org id are operational facts; a payload, an email or a token in a log line
     * outlives the delete it was recording.
     */
    const actions = code(read("src/app/dashboard/settings/danger-actions.ts"));
    for (const line of actions.split("\n").filter((l) => l.includes("console."))) {
      expect(line, line.trim()).not.toMatch(/email|credential|token|payload/i);
    }
  });

  it("walls every delete by the org it was asked about", () => {
    /**
     * `usage_ledger` holds one row that belongs to NOBODY — the fleet-wide
     * provider budget under a sentinel org — and an unwalled sweep of that table
     * would reset every customer's shared ceiling. Every statement in the sweep
     * carries the org predicate.
     */
    expect(destroy).toMatch(/eq\(\(table as any\)\.orgId, orgId\)/);
  });
});

