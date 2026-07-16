import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy — Namzilabs" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link className="text-sm text-neutral-500 hover:text-neutral-800" href="/">
        &larr; Namzilabs
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: July 16, 2026</p>

      <div className="mt-8 space-y-6 text-neutral-700">
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Overview</h2>
          <p className="mt-2">
            Namzilabs (&ldquo;we&rdquo;) helps you consolidate data from the tools you connect into
            a single dashboard. This policy explains what we collect, how we use it, and the
            choices you have.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Information we collect</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Account information (name and email) used to sign in.</li>
            <li>
              Data from the third-party services you explicitly connect (such as Calendly, Close,
              Instantly, Sendblue and Google Workspace), retrieved only to display it back to you.
            </li>
            <li>Basic operational logs needed to run the Service reliably.</li>
          </ul>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Google user data</h2>
          <p className="mt-2">
            If you connect a Google account, we request read access to the Google Sheets and Google
            Drive files you choose. We use this access solely to read the spreadsheet data you ask
            us to display in your Namzilabs dashboard and metrics. Namzilabs&rsquo; use of
            information received from Google APIs adheres to the{" "}
            <a
              className="text-blue-600 underline"
              href="https://developers.google.com/terms/api-services-user-data-policy"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. We do not use Google user data for
            advertising, and we do not sell it or share it with third parties except as needed to
            operate the Service for you.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">How we use data</h2>
          <p className="mt-2">
            We use connected data only to provide the Service to your organization: to display
            unified metrics and dashboards. We do not sell your data or use it for advertising.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Storage &amp; security</h2>
          <p className="mt-2">
            Credentials and access tokens are encrypted at rest. Data is isolated per organization,
            and access is scoped to your authenticated session.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Your choices</h2>
          <p className="mt-2">
            You can disconnect any integration at any time, which stops further data collection from
            that source. You may request deletion of your data by contacting us.
          </p>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-neutral-900">Contact</h2>
          <p className="mt-2">
            Questions or deletion requests? Email{" "}
            <a className="text-blue-600 underline" href="mailto:support@namzilabs.com">
              support@namzilabs.com
            </a>
            .
          </p>
        </section>
      </div>

      <p className="mt-10 text-sm text-neutral-500">
        See also our{" "}
        <Link className="text-blue-600 underline" href="/terms">
          Terms of Service
        </Link>
        .
      </p>
    </main>
  );
}
