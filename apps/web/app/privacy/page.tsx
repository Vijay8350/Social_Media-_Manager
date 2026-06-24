import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How we collect, use, and protect your data.",
};

const LAST_UPDATED = "22 June 2026";
const CONTACT_EMAIL = "derik6013@gmail.com";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-neutral-500">Last updated: {LAST_UPDATED}</p>

      <div className="mt-8 space-y-6 text-sm leading-6 text-neutral-700">
        <p>
          This Privacy Policy explains how the Service (&ldquo;we&rdquo;,
          &ldquo;us&rdquo;) collects, uses, and protects your information when
          you use our application that generates content and publishes it to
          Instagram on your behalf. By using the Service you agree to this
          policy.
        </p>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            1. Information we collect
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Account information:</strong> your email address and
              authentication details, managed through our authentication
              provider (Supabase).
            </li>
            <li>
              <strong>Instagram &amp; Facebook data:</strong> when you connect an
              account via Facebook Login, we access your Instagram Business/Creator
              account ID and username, the linked Facebook Page ID, and an access
              token used to publish posts and read post insights. Access tokens
              are <strong>encrypted at rest</strong>.
            </li>
            <li>
              <strong>Content you create:</strong> your account &ldquo;DNA&rdquo;
              (persona, niche, visual preferences), prompts, generated captions,
              hashtags, and images.
            </li>
            <li>
              <strong>Usage &amp; logs:</strong> operational logs of generation
              and publishing jobs, used to run and debug the Service.
            </li>
            <li>
              <strong>Payment information:</strong> if you subscribe, billing is
              handled by Stripe. We do not store your full card details.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            2. How we use your information
          </h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>To generate content and publish posts to your connected Instagram accounts.</li>
            <li>To retrieve post performance metrics and improve future content.</li>
            <li>To operate, secure, and support the Service, and to process subscriptions.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            3. Third-party services
          </h2>
          <p className="mt-2">
            We share data only as needed with the providers that power the
            Service: <strong>Meta / Instagram Graph API</strong> (publishing and
            insights), <strong>Supabase</strong> (database, authentication,
            storage), <strong>DeepSeek</strong> (text generation),{" "}
            <strong>Google Gemini</strong> (image generation and quality checks),
            and <strong>Stripe</strong> (payments). Each processes data under its
            own terms and privacy policy. Our use of information received from
            Meta APIs follows the Meta Platform Terms and Developer Policies.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            4. Data retention &amp; deletion
          </h2>
          <p className="mt-2">
            We keep your data while your account is active. You can disconnect an
            Instagram account at any time from the dashboard, which deletes the
            stored access token for that account. To delete your account and all
            associated data, email us at{" "}
            <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>{" "}
            and we will remove it, including revoking stored tokens.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">5. Your rights</h2>
          <p className="mt-2">
            You may request access to, correction of, or deletion of your
            personal data by contacting us. You can also revoke this app&rsquo;s
            access from your Facebook account settings at any time.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">6. Security</h2>
          <p className="mt-2">
            We use industry-standard measures including encryption of access
            tokens at rest, encrypted transport (HTTPS), and per-user data
            isolation. No method of transmission or storage is 100% secure, but
            we work to protect your information.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            7. Children&rsquo;s privacy
          </h2>
          <p className="mt-2">
            The Service is not directed to anyone under 18, and we do not
            knowingly collect data from children.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">
            8. Changes to this policy
          </h2>
          <p className="mt-2">
            We may update this policy from time to time. Material changes will be
            reflected by updating the &ldquo;Last updated&rdquo; date above.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-neutral-900">9. Contact</h2>
          <p className="mt-2">
            Questions about this policy? Email{" "}
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
