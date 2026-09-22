import type { Metadata } from "next";
import { LegalLink, LegalList, LegalPage, LegalSection } from "@/components/ui/legal";

export const metadata: Metadata = {
  title: "Deleting your data — Namzilabs",
  description: "How to delete the data Namzilabs holds for you, yourself, immediately.",
};

/**
 * THE DATA DELETION INSTRUCTIONS PAGE.
 *
 * PUBLIC AND UNAUTHENTICATED, and that is the load-bearing property rather than
 * a nicety. Meta, TikTok and Google all require a reachable deletion route
 * before an app passes review, and the person checking it is a reviewer with no
 * account here — a page that bounces to sign-in reads as no page at all and
 * fails the review. `src/proxy.ts` keeps it public by omission (it is not in
 * PROTECTED_PAGE_PREFIXES); `tests/data-deletion.test.ts` pins that, because
 * "we forgot to protect it" and "it is deliberately open" look identical in a
 * list of prefixes.
 *
 * EVERY CLAIM HERE IS CHECKED AGAINST THE CODE THAT DOES THE WORK. The
 * self-serve routes are `DangerZone.tsx` → `deleteWorkspaceAction` →
 * `destroyWorkspaceData`, and the per-connection delete in `ConnectionRow.tsx`.
 * The one thing that survives is `audit_log`, which is exempted deliberately in
 * `destroy.ts` and held by `tests/audit.test.ts` to containing no personal data
 * and no user content — so saying so here is a promise the suite enforces
 * rather than a sentence somebody wrote.
 */
export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Deleting your data"
      updated="September 22, 2026"
      also={{ href: "/privacy", label: "Privacy Policy" }}
    >
      <LegalSection title="The short version">
        <p>
          You can delete everything Namzilabs holds for you yourself, from inside the app, without asking us and
          without waiting. It happens immediately and it cannot be undone — there is no grace period and no bin to
          recover from.
        </p>
      </LegalSection>

      <LegalSection title="Delete the data from one connected app">
        <p>Use this when you want to remove one source — a Meta ad account, say — and keep the rest.</p>
        <LegalList>
          <li>Sign in and open <strong>Apps</strong>.</li>
          <li>Switch to <strong>Manage</strong> and find the connection.</li>
          <li>
            Choose <strong>Delete permanently</strong> (the bin), type the connection&rsquo;s name to confirm, then{" "}
            choose <strong>Delete everything</strong>.
          </li>
        </LegalList>
        <p>
          That removes the connection, the credentials we hold for it, and every record we synced from it. Where the
          provider supports it, we also ask them to stop sending us your data on the way out.
        </p>
        <p>
          If you only want the syncing to stop, choose <strong>Disconnect</strong> instead. That keeps what has{" "}
          already been synced and can be reversed — it is not a deletion.
        </p>
      </LegalSection>

      <LegalSection title="Delete everything">
        <LegalList>
          <li>Sign in and open <strong>Settings</strong>.</li>
          <li>
            Find <strong>Delete this workspace</strong> under the danger zone.
          </li>
          <li>
            Type the workspace name to confirm, then choose <strong>Delete forever</strong>.
          </li>
        </LegalList>
        <p>
          This removes every metric, flow, dashboard, connection, stored credential and synced record belonging to the
          workspace, immediately and permanently.
        </p>
        <p>
          Only the workspace owner can do this. If you are a member rather than the owner, ask them — or write to us
          using the address below and we will handle it.
        </p>
      </LegalSection>

      <LegalSection title="If you connected through Meta, TikTok or Google">
        <p>
          Deleting the connection here removes your data from Namzilabs. Separately, you can withdraw the
          authorisation itself from the provider&rsquo;s own settings, which stops us being able to ask for anything
          again:
        </p>
        <LegalList>
          <li>
            <strong>Meta</strong> — Business settings, then remove Namzilabs from the business{" "}
            portfolio&rsquo;s connected apps.
          </li>
          <li>
            <strong>TikTok</strong> — Business Center, then remove the authorisation from the advertiser account.
          </li>
          <li>
            <strong>Google</strong> —{" "}
            <LegalLink href="https://myaccount.google.com/permissions">
              your Google account&rsquo;s third-party access page
            </LegalLink>
            . Deleting a Google connection here already hands the grant back automatically.
          </li>
        </LegalList>
        <p>
          Withdrawing access at the provider stops future syncing. It does not delete what we already hold — use one of
          the routes above for that.
        </p>
      </LegalSection>

      <LegalSection title="If you cannot sign in">
        <p>
          Email <LegalLink href="mailto:support@namzilabs.com">support@namzilabs.com</LegalLink> from the address on{" "}
          the account and tell us what you want removed. We will confirm what was deleted once it is done, and we aim to
          complete requests within 30 days.
        </p>
      </LegalSection>

      <LegalSection title="What is not deleted, and why">
        <p>
          One thing outlives a deletion: an internal record of administrative actions — that a workspace was deleted,
          when, and by which account. An audit trail the audited act erases cannot answer the question it exists for.
        </p>
        <p>
          It holds no personal data and none of the content from the tools you connected, and our tests enforce that
          rather than leaving it to good intentions. Routine operational logs age out on their own schedule and are
          never used to reconstruct anything you deleted.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
