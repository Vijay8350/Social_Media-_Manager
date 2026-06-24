import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of the Service.",
};

const LAST_UPDATED = "22 June 2026";
const CONTACT_EMAIL = "marketplace@deodap.com";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 space-y-6 text-sm leading-6 text-neutral-700">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the
          Service. By creating an account or using the Service, you agree to
          these Terms. If you do not agree, do not use the Service.
        </p>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            1. Description of the Service
          </h2>
          <p className="mt-2">
            The Service generates AI-assisted content (text and images) and can
            automatically publish it to Instagram accounts you connect, on a
            schedule you configure, subject to an automated quality check.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">2. Eligibility</h2>
          <p className="mt-2">
            You must be at least 18 and able to form a binding contract. You must
            own or be authorized to manage any Instagram accounts you connect, and
            your use must comply with the{" "}
            <a className="underline" href="https://www.facebook.com/legal/terms" target="_blank" rel="noreferrer">
              Meta Platform Terms
            </a>{" "}
            and{" "}
            <a className="underline" href="https://help.instagram.com/581066165581870" target="_blank" rel="noreferrer">
              Instagram&rsquo;s Terms of Use
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            3. Your account &amp; responsibilities
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>You are responsible for activity under your account and for keeping your credentials secure.</li>
            <li>You are responsible for the content generated and published through your connected accounts.</li>
            <li>You will not use the Service to publish unlawful, infringing, hateful, or deceptive content, or to spam.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            4. Content &amp; AI-generated material
          </h2>
          <p className="mt-2">
            You retain ownership of the content you provide. Content is generated
            by AI models and may be inaccurate or unexpected; you are responsible
            for reviewing what is published and for ensuring it complies with
            applicable laws and platform rules. We grant you the right to use the
            content produced for you through the Service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            5. Third-party platforms
          </h2>
          <p className="mt-2">
            The Service relies on Meta/Instagram APIs and other third-party
            providers. We do not control those platforms and are not responsible
            for their availability, changes, rate limits, or account actions they
            take (including suspensions). Access may be interrupted if a platform
            changes its API or revokes access.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            6. Subscriptions &amp; billing
          </h2>
          <p className="mt-2">
            Paid plans are billed through Stripe on a recurring basis until
            cancelled. You can manage or cancel your subscription via the billing
            portal. Fees are non-refundable except where required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            7. Disclaimers &amp; limitation of liability
          </h2>
          <p className="mt-2">
            The Service is provided &ldquo;as is&rdquo; without warranties of any
            kind. To the maximum extent permitted by law, we are not liable for
            indirect, incidental, or consequential damages, or for any lost
            profits, data, or goodwill arising from your use of the Service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">8. Termination</h2>
          <p className="mt-2">
            You may stop using the Service and delete your account at any time. We
            may suspend or terminate access if you violate these Terms or use the
            Service in a way that risks harm to others or to the platforms we
            integrate with.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            9. Changes to these Terms
          </h2>
          <p className="mt-2">
            We may update these Terms from time to time. Continued use after
            changes take effect constitutes acceptance of the updated Terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">10. Contact</h2>
          <p className="mt-2">
            Questions about these Terms? Email{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
