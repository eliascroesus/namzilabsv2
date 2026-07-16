import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service — Namzilabs" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link className="text-sm text-neutral-500 hover:text-neutral-800" href="/">
        &larr; Namzilabs
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: July 16, 2026</p>

      <div className="mt-8 space-y-6 text-neutral-700">
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">1. Acceptance of terms</h2>
          <p className="mt-2">
            By accessing or using Namzilabs (the &ldquo;Service&rdquo;), you agree to be bound by
            these Terms. If you do not agree, do not use the Service.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">2. The Service</h2>
          <p className="mt-2">
            Namzilabs connects to third-party tools you authorize (such as Calendly, Close,
            Instantly, Sendblue and Google Workspace) and consolidates the data from those tools
            into a single dashboard and custom metrics for your organization.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">3. Your account and data</h2>
          <p className="mt-2">
            You are responsible for maintaining the security of your account and for the accuracy
            of the integrations you connect. You retain ownership of your data. You grant us the
            limited right to access and process connected data solely to operate the Service for
            you.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">4. Acceptable use</h2>
          <p className="mt-2">
            You agree not to misuse the Service, attempt to access data belonging to other
            organizations, or use the Service to violate any law or the terms of the third-party
            services you connect.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">5. Termination</h2>
          <p className="mt-2">
            You may stop using the Service at any time and disconnect your integrations. We may
            suspend or terminate access for violations of these Terms.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">6. Disclaimer &amp; liability</h2>
          <p className="mt-2">
            The Service is provided &ldquo;as is&rdquo; without warranties of any kind. To the
            extent permitted by law, Namzilabs is not liable for any indirect or consequential
            damages arising from your use of the Service.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">7. Contact</h2>
          <p className="mt-2">
            Questions about these Terms? Email{" "}
            <a className="text-blue-600 underline" href="mailto:support@namzilabs.com">
              support@namzilabs.com
            </a>
            .
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm text-neutral-500">
        See also our{" "}
        <Link className="text-blue-600 underline" href="/privacy">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
