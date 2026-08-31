import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initialsOf } from "@/lib/profile";
import { workspaceCap } from "@/lib/limits";

/**
 * A PERSON, AND HOW MANY WORKSPACES THEY MAY MAKE.
 *
 * Two features that share one property worth guarding: they are the only writes
 * in the product that are NOT tenant-scoped. Everything else starts with
 * `requireOrg()` and walls its query by `org_id`; a name, a picture and a
 * workspace count belong to a human, who exists across workspaces. That makes
 * the gate different rather than absent, and the assertions below are mostly
 * about which gate.
 */
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = read("src/app/actions.ts");
const profileActions = read("src/app/dashboard/profile/actions.ts");
const switcher = read("src/components/org-switcher.tsx");
const shell = read("src/components/app-shell.tsx");

describe("two letters for the chip", () => {
  it("splits a name on words and an email on characters", () => {
    // "Elias Croesus" has a word boundary to find; an email does not, and "el"
    // is what every other product shows for one.
    expect(initialsOf("Elias Croesus")).toBe("EC");
    expect(initialsOf("eliascroesus@gmail.com")).toBe("EL");
    expect(initialsOf("Ada")).toBe("AD");
  });

  it("takes the FIRST and LAST word, not the first two", () => {
    // A middle name must not decide somebody's initials.
    expect(initialsOf("Ada Byron Lovelace")).toBe("AL");
  });

  it("answers something for an empty string rather than throwing", () => {
    // It is drawn in the chrome on every route; a blank chip is survivable and
    // an exception in the shell is not.
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });

  it("is spelled once, and the three surfaces that draw the chip share it", () => {
    // The rail's foot, the top bar's trigger and the panel behind it. Three
    // copies of "take the first letters" is how one of them ends up disagreeing.
    expect(shell).toMatch(/getProfile\(userId, userEmail \?\? null\)/);
    expect(shell).toMatch(/const initials = profile\.initials/);
  });
});

describe("the workspace cap", () => {
  it("is three, and lives with every other limit", () => {
    expect(workspaceCap()).toBe(3);
  });

  it("counts what you CREATED, not what you belong to", () => {
    /**
     * Being invited into a dozen workspaces must not spend somebody's own
     * allowance. `workspace_owners.source = 'created'` separates a real
     * creation from the backfill that adopted pre-existing orgs.
     */
    expect(code(actions)).toMatch(/eq\(workspaceOwners\.source, "created"\)/);
    expect(code(actions)).toMatch(/if \(owned >= cap\) redirect/);
  });

  it("is enforced on the SERVER, not by hiding the menu row", () => {
    // A server action is a public endpoint whatever the menu happens to be
    // drawing. The switcher's `canCreate` is a courtesy; this is the wall.
    expect(code(actions)).toMatch(/workspaceCap\(\)/);
    expect(switcher).toMatch(/canCreate\?: boolean/);
    expect(shell).toMatch(/canCreate=\{ownedCount < workspaceCap\(\)\}/);
  });

  it("checks the cap AFTER the duplicate guard", () => {
    /**
     * A double-submit at the cap must still land you in the workspace you just
     * made rather than refusing. The duplicate guard returns first, so the
     * order here is behaviour rather than tidiness.
     */
    const dup = actions.indexOf("if (dup) {");
    const cap = actions.indexOf("if (owned >= cap)");
    expect(dup).toBeGreaterThan(-1);
    expect(cap).toBeGreaterThan(dup);
  });

  it("does not lock somebody out of their own product when the count fails", () => {
    // A read failure is our problem, not a reason to refuse a workspace.
    expect(actions).toMatch(/\.catch\(\(\) => 0\)/);
  });

  it("says why it refused, instead of redirecting silently", () => {
    // A refusal with nowhere to report is a navigation that changes nothing:
    // you name a workspace, press Create, and land back with no workspace and
    // no reason. The dashboard's banner is the only reader of `?error=`.
    expect(actions).toMatch(/error=workspace_limit/);
    expect(read("src/app/dashboard/page.tsx")).toMatch(/"workspace_limit",/);
  });

  it("hides the create row at the cap rather than disabling it", () => {
    // `ViewTab` already states the rule: a control advertising something the
    // product will refuse is worse than one that is not there yet.
    expect(switcher).toMatch(/\{canCreate && <NewWorkspaceRow \/>\}/);
    expect(switcher).not.toMatch(/disabled=\{!canCreate\}/);
  });
});

describe("editing your own profile", () => {
  it("takes the user id from the SESSION, never from the form", () => {
    // The one thing that would let a crafted post rename somebody else.
    for (const fn of ["updateDisplayNameAction", "uploadAvatarAction", "removeAvatarAction"]) {
      const body = profileActions.slice(profileActions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 900), `${fn} must read the session`).toMatch(
        /withAuth\(\{ ensureSignedIn: true \}\)/,
      );
    }
    expect(code(profileActions)).not.toMatch(/fd\.get\("userId"\)/);
  });

  it("treats an empty name as a choice, not as a failure", () => {
    // Clearing the field means "go back to using my email", which is real.
    expect(profileActions).toMatch(/parsed\.data\.length > 0 \? parsed\.data : null/);
  });

  it("re-checks the file's type and size on the server", () => {
    // A file input's `accept` filters the picker; it is not a rule, and
    // anything can POST to a server action.
    expect(profileActions).toMatch(/MAX_BYTES/);
    expect(profileActions).toMatch(/ALLOWED\.has\(file\.type\)/);
  });

  it("says which half is unconfigured instead of failing opaquely", () => {
    // `put` throws a generic error with no token, which reads to a customer as
    // "uploads are broken" rather than "this environment is not finished".
    expect(profileActions).toMatch(/BLOB_READ_WRITE_TOKEN/);
    expect(profileActions).toMatch(/aren&rsquo;t configured|aren't configured/);
  });

  it("stores a URL and deletes the old blob AFTER the new one lands", () => {
    /**
     * Order matters: deleting first leaves somebody with no avatar if the
     * upload then fails. The worst case this way is one orphaned blob.
     * `addRandomSuffix` because overwriting one key per user leaves the old
     * image in every CDN cache — the new picture would keep showing as the old.
     */
    expect(profileActions).toMatch(/addRandomSuffix: true/);
    const upload = profileActions.slice(profileActions.indexOf("export async function uploadAvatarAction"));
    expect(upload.indexOf("del(prev.avatarUrl)")).toBeGreaterThan(upload.indexOf("blob.url"));
  });

  it("refreshes every route, because the chrome draws this on all of them", () => {
    expect(profileActions).toMatch(/revalidatePath\("\/", "layout"\)/);
  });
});

describe("the row that reaches the profile", () => {
  it("is in the band that is already about you", () => {
    // Clicking your own avatar and finding only a workspace list and a way out
    // is the gap this closes.
    expect(shell).toMatch(/href="\/dashboard\/profile"/);
  });

  it("shows the picture in the chrome once there is one", () => {
    // A profile page that changes nothing visible is a form that appears not to
    // have worked.
    expect(shell).toMatch(/profile\.avatarUrl \? \(/);
    expect(read("src/components/top-bar.tsx")).toMatch(/account\.avatarUrl \? \(/);
  });
});

describe("the table behind it", () => {
  const schema = read("src/db/schema.ts");

  it("stores a URL, never image bytes", () => {
    // A table read on every page render must not carry a photograph — the same
    // argument `publishedFlowTiles` makes for dropping `byDay`.
    expect(schema).toMatch(/avatarUrl: text\("avatar_url"\)/);
    expect(schema).not.toMatch(/avatarBlob|avatar_data|bytea/);
  });

  it("has a migration registered in the journal, or the tests build without it", () => {
    /**
     * A hand-written SQL file that is not in `_journal.json` is applied by
     * NOBODY: not by `drizzle-kit migrate`, and not by the test database, which
     * builds itself from the same journal. The suite would then pass against a
     * schema the code does not match.
     */
    const journal = read("drizzle/meta/_journal.json");
    expect(journal).toContain("0030_user_profiles");
    expect(read("drizzle/0030_user_profiles.sql")).toMatch(/CREATE TABLE IF NOT EXISTS "user_profiles"/);
  });
});
