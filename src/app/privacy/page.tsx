import type { Metadata } from "next";
import { LegalLink, LegalList, LegalPage, LegalSection } from "@/components/ui/legal";

export const metadata: Metadata = { title: "Privacy Policy — Namzilabs" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 16, 2026" also={{ href: "/terms", label: "Terms of Service" }}>
      <LegalSection title="Overview">
        <p>
          Namzilabs (&ldquo;we&rdquo;) helps you consolidate data from the tools you connect into a single dashboard.
          This policy explains what we collect, how we use it, and the choices you have.
        </p>
      </LegalSection>

      <LegalSection title="Information we collect">
        <LegalList>
          <li>Account information (name and email) used to sign in.</li>
          <li>
            Data from the third-party services you explicitly connect (such as Calendly, Close, Instantly and Google
            Workspace), retrieved only to display it back to you.
          </li>
          <li>Basic operational logs needed to run the Service reliably.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Google user data">
        <p>
          If you connect a Google account, we request read access to the Google Sheets and Google Drive files you
          choose. We use this access solely to read the spreadsheet data you ask us to display in your Namzilabs
          dashboard and metrics. Namzilabs&rsquo; use of information received from Google APIs adheres to the{" "}
          <LegalLink href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </LegalLink>
          , including the Limited Use requirements. We do not use Google user data for advertising, and we do not sell
          it or share it with third parties except as needed to operate the Service for you.
        </p>
      </LegalSection>

      <LegalSection title="How we use data">
        <p>
          We use connected data only to provide the Service to your organization: to display unified metrics and
          dashboards. We do not sell your data or use it for advertising.
        </p>
      </LegalSection>

      <LegalSection title="Storage &amp; security">
        <p>
          Credentials and access tokens are encrypted at rest. Data is isolated per organization, and access is scoped
          to your authenticated session.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can disconnect any integration at any time, which stops further data collection from that source. You may
          request deletion of your data by contacting us.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions or deletion requests? Email{" "}
          <LegalLink href="mailto:support@namzilabs.com">support@namzilabs.com</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
