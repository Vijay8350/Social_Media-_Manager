import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Data Deletion",
  description: "How to request deletion of your data.",
};

const CONTACT_EMAIL = "derik6013@gmail.com";

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const code = typeof sp.id === "string" ? sp.id : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        User Data Deletion
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">Social Media Manager</p>

      {code && (
        <div className="mt-6 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          We received a data deletion request. Your confirmation code is{" "}
          <span className="font-mono font-medium">{code}</span>. Your data will
          be permanently deleted within 30 days. Keep this code for reference.
        </div>
      )}

      <div className="mt-8 space-y-6 text-sm leading-6 text-muted-foreground">
        <p>
          At Social Media Manager, we respect your right to control your personal
          data. If you would like to delete the data associated with your
          account, follow the steps below.
        </p>

        <section>
          <h2 className="text-lg font-medium text-foreground">
            How to request data deletion
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Send an email to{" "}
              <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>{" "}
              with the subject line <strong>&ldquo;Data Deletion Request&rdquo;</strong>.
            </li>
            <li>
              Include the email address or username associated with your account
              so we can verify your identity.
            </li>
            <li>
              Optionally, specify whether you want to delete your entire account
              or only specific data (such as connected social accounts or stored
              posts).
            </li>
          </ol>
          <p className="mt-3">
            You can also remove this app&rsquo;s access at any time from your
            Facebook account &rarr; Settings &rarr; Apps and Websites, and
            disconnect an account directly from your dashboard (which immediately
            deletes that account&rsquo;s stored access token).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-foreground">
            What happens next
          </h2>
          <p className="mt-2">
            Once we receive your request, we verify your identity and permanently
            delete your personal data from our systems within 30 days. This
            includes any data obtained through Facebook or Instagram login — such
            as your profile information, access tokens, and content you stored in
            the app. You will receive a confirmation email once deletion is
            complete.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-foreground">
            Data we remove
          </h2>
          <p className="mt-2">
            Your account profile, authentication tokens, connected platform
            credentials, scheduled or published content stored in our system, and
            any analytics tied to your account.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-foreground">Questions</h2>
          <p className="mt-2">
            If you have any questions about how we handle your data, contact us at{" "}
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
