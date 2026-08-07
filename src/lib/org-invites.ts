/**
 * The tenant wall for invitation revocation.
 *
 * WorkOS's `revokeInvitation(invitationId)` takes ONLY the id, and the id
 * arrives from the browser — so without this check any signed-in user could
 * revoke any workspace's pending invitation by guessing/leaking ids. The
 * revoke action must `getInvitation` first and refuse unless the invitation
 * belongs to the caller's org. Same class of wall as `replayRawEvent`'s org
 * check: the external call is capability-shaped, so the boundary is ours to
 * enforce.
 *
 * `organizationId: null` is REJECTED, not treated as "unowned and therefore
 * fine": WorkOS supports org-less invitations, and an org-scoped page has no
 * business revoking something it cannot claim.
 *
 * Pure and separate from the "use server" actions file so it is importable
 * in tests without dragging in next/navigation.
 */
export function invitationBelongsToOrg(invitation: { organizationId: string | null }, orgId: string): boolean {
  return invitation.organizationId != null && invitation.organizationId === orgId;
}
