import type { Metadata } from "next";
import { LegalLink, LegalPage, LegalSection } from "@/components/ui/legal";

export const metadata: Metadata = { title: "Terms of Service — Namzilabs" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 16, 2026" also={{ href: "/privacy", label: "Privacy Policy" }}>
      <LegalSection title="1. Acceptance of terms">
        <p>
          By accessing or using Namzilabs (the &ldquo;Service&rdquo;), you agree to be bound by these Terms. If you do
          not agree, do not use the Service.
        </p>
      </LegalSection>

      <LegalSection title="2. The Service">
        <p>
          Namzilabs connects to third-party tools you authorize (such as Calendly, Close, Instantly and Google
          Workspace) and consolidates the data from those tools into a single dashboard and custom metrics for your
          organization.
        </p>
      </LegalSection>

      <LegalSection title="3. Your account and data">
        <p>
          You are responsible for maintaining the security of your account and for the accuracy of the integrations you
          connect. You retain ownership of your data. You grant us the limited right to access and process connected
          data solely to operate the Service for you.
        </p>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <p>
          You agree not to misuse the Service, attempt to access data belonging to other organizations, or use the
          Service to violate any law or the terms of the third-party services you connect.
        </p>
      </LegalSection>

      <LegalSection title="5. Termination">
        <p>
          You may stop using the Service at any time and disconnect your integrations. We may suspend or terminate
          access for violations of these Terms.
        </p>
      </LegalSection>

      <LegalSection title="6. Disclaimer &amp; liability">
        <p>
          The Service is provided &ldquo;as is&rdquo; without warranties of any kind. To the extent permitted by law,
          Namzilabs is not liable for any indirect or consequential damages arising from your use of the Service.
        </p>
      </LegalSection>

      <LegalSection title="7. Contact">
        <p>
          Questions about these Terms? Email{" "}
          <LegalLink href="mailto:support@namzilabs.com">support@namzilabs.com</LegalLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
