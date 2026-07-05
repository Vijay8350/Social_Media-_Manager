import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isInstagramConfigured } from "@/lib/instagram-config";
import type { InstagramAccount } from "@insta/shared";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Instagram isn't configured yet — add FACEBOOK_APP_ID / FACEBOOK_APP_SECRET to your env.",
  invalid_state: "The connection request expired or was tampered with. Please try again.",
  no_pages:
    "No Facebook Pages were found on that account. You need a Page linked to an Instagram Business/Creator account.",
  no_business_account:
    "That Page has no linked Instagram Business or Creator account. Link one in your Page settings and retry.",
  save_failed: "Couldn't save the connection. Please try again.",
  not_found: "That account no longer exists.",
};

function humanizeError(code: string): string {
  return ERROR_MESSAGES[code] ?? `Connection failed: ${code}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: accounts } = await supabase
    .from("instagram_accounts")
    .select("*")
    .order("created_at", { ascending: true });

  const list = (accounts ?? []) as InstagramAccount[];
  const configured = isInstagramConfigured();

  const sp = await searchParams;
  const igError = typeof sp.ig_error === "string" ? sp.ig_error : null;
  const igConnected =
    typeof sp.ig_connected === "string" ? Number(sp.ig_connected) : 0;
  const igDisconnected = sp.ig_disconnected === "1";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Signed in as {user.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/dashboard/billing"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Billing
          </a>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Status banners */}
      {igConnected > 0 && (
        <p className="mt-6 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          Connected {igConnected} Instagram account{igConnected > 1 ? "s" : ""}.
        </p>
      )}
      {igDisconnected && (
        <p className="mt-6 rounded-md bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
          Instagram account disconnected.
        </p>
      )}
      {igError && (
        <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          {humanizeError(igError)}
        </p>
      )}

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Instagram accounts</h2>
          {configured ? (
            <a
              href="/api/instagram/connect"
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Connect Instagram
            </a>
          ) : (
            <span className="text-xs text-neutral-500">
              Set Meta app credentials to enable
            </span>
          )}
        </div>

        {list.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
            No accounts connected yet. Connect a Business or Creator account
            that&apos;s linked to a Facebook Page.
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {list.map((acct) => (
              <li
                key={acct.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    @{acct.ig_username ?? acct.ig_user_id ?? "unknown"}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {statusLabel(acct.status)}
                    {acct.token_expiry
                      ? ` · token valid until ${new Date(
                          acct.token_expiry,
                        ).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={`/dashboard/accounts/${acct.id}/dna`}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
                  >
                    DNA
                  </a>
                  <a
                    href={`/dashboard/accounts/${acct.id}/prompts`}
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
                  >
                    Prompts
                  </a>
                  <form
                    action={`/api/instagram/${acct.id}/disconnect`}
                    method="post"
                  >
                    <button
                      type="submit"
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
                    >
                      Disconnect
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-neutral-500">
          Requires an Instagram Business or Creator account linked to a Facebook
          Page. In Meta dev mode, only the app owner and whitelisted test
          accounts can connect.
        </p>
      </section>
    </main>
  );
}

function statusLabel(status: InstagramAccount["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_reauth":
      return "Needs re-authentication";
    case "ineligible":
      return "Ineligible (no linked IG Business account)";
    default:
      return "Disconnected";
  }
}
