import { describe, it, expect } from "vitest";
import { invitationBelongsToOrg } from "@/lib/org-invites";

/**
 * The tenant wall for invitation revocation. WorkOS's revokeInvitation takes
 * ONLY the invitation id, and the id arrives from the browser — so this guard
 * is the entire difference between "revoke my workspace's invite" and "revoke
 * anyone's invite by id". The WorkOS network calls themselves are untestable
 * in CI (external SaaS; mocking the SDK would test the mock) — the wall is
 * the load-bearing piece, and it is pure.
 */
describe("invitationBelongsToOrg", () => {
  it("accepts the caller's own org", () => {
    expect(invitationBelongsToOrg({ organizationId: "org_a" }, "org_a")).toBe(true);
  });

  it("refuses a foreign org — the browser-supplied-id attack", () => {
    expect(invitationBelongsToOrg({ organizationId: "org_b" }, "org_a")).toBe(false);
  });

  it("refuses an org-less invitation — null is not 'unowned and therefore fine'", () => {
    // WorkOS supports invitations with no organization; an org-scoped page
    // has no business revoking something it cannot claim. Sabotage pin:
    // `invitation.organizationId == orgId`-style loose logic or a dropped
    // null check fails here.
    expect(invitationBelongsToOrg({ organizationId: null }, "org_a")).toBe(false);
  });
});
