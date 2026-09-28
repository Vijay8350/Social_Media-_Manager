import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isInstagramConfigured } from "@/lib/instagram-config";
import type { InstagramAccount, Post } from "@insta/shared";
import { getDefaultAccountId, resolveDefaultAccount } from "@/lib/default-account";
import { AccountDetails } from "@/components/AccountDetails";
import { LocalTime } from "@/components/LocalTime";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Instagram isn't configured yet — add FACEBOOK_APP_ID / FACEBOOK_APP_SECRET to your env.",
  invalid_state: "The connection request expired or was tampered with. Please try again.",
  no_pages: "No Facebook Pages were found. You need a Page linked to an Instagram Business/Creator account.",
  no_business_account: "That Page has no linked Instagram Business or Creator account.",
  save_failed: "Couldn't save the connection. Please try again.",
  not_found: "That account no longer exists.",
};

/** Shortcuts to the default account's tools (the account page tabs). */
const TOOLS = [
  { label: "Account DNA", path: "dna" },
  { label: "Business DNA", path: "business-dna" },
  { label: "Prompt Library", path: "prompts" },
  { label: "Content", path: "content" },
  { label: "Schedule", path: "schedule" },
  { label: "Analytics", path: "analytics" },
];

type PostRow = Pick<Post, "id" | "headline" | "status" | "origin" | "created_at">;

function DetailsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="card h-44 animate-pulse bg-muted/40" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card h-72 animate-pulse bg-muted/40" />
        <div className="card h-72 animate-pulse bg-muted/40" />
      </div>
    </div>
  );
}

/** Dashboard home: everything for the default Instagram account (others via the sidebar switcher). */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: accounts }, savedDefault] = await Promise.all([
    supabase.from("instagram_accounts").select("*").order("created_at", { ascending: true }),
    user ? getDefaultAccountId(supabase, user.id) : Promise.resolve(null),
  ]);
  const list = (accounts ?? []) as InstagramAccount[];
  const account = resolveDefaultAccount(list, savedDefault);

  // Stats + activity for the default account only.
  let posts: PostRow[] = [];
  let flagged = 0;
  if (account) {
    const [{ data: postRows }, { count }] = await Promise.all([
      supabase
        .from("posts")
        .select("id, headline, status, origin, created_at")
        .eq("account_id", account.id)
        .order("created_at", { ascending: false })
        .limit(40),
      // null (no badge) until migration 0005 is applied
      supabase
        .from("ig_comments")
        .select("id", { count: "exact", head: true })
        .eq("account_id", account.id)
        .eq("status", "flagged"),
    ]);
    posts = (postRows as PostRow[] | null) ?? [];
    flagged = count ?? 0;
  }
  const weekAgo = Date.now() - 7 * 864e5;
  const stats = [
    { label: "Posts this week", value: posts.filter((p) => new Date(p.created_at).getTime() > weekAgo).length, sub: "generated", href: null },
    { label: "Published", value: posts.filter((p) => p.status === "published").length, sub: "live on Instagram", href: null },
    { label: "Blocked & skipped", value: posts.filter((p) => p.status === "qa_failed" || p.status === "skipped").length, sub: "never published on fail", href: null },
    { label: "Flagged comments", value: flagged, sub: flagged ? "waiting for review →" : "none waiting", href: account ? `/dashboard/comments?account=${account.id}` : null },
  ];

  const sp = await searchParams;
  const igError = typeof sp.ig_error === "string" ? sp.ig_error : null;
  const igConnected = typeof sp.ig_connected === "string" ? Number(sp.ig_connected) : 0;
  const igDisconnected = sp.ig_disconnected === "1";
  const configured = isInstagramConfigured();
  const username = account?.ig_username ?? account?.ig_user_id ?? "account";

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {account ? `@${username} — your default account` : `Signed in as ${user?.email}`}
          </p>
        </div>
        {configured && (
          <a href="/api/instagram/connect" className="btn-primary">＋ Connect Instagram</a>
        )}
      </div>

      {igConnected > 0 && (
        <p className="mt-5 rounded-lg bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          Connected {igConnected} Instagram account{igConnected > 1 ? "s" : ""}.
        </p>
      )}
      {igDisconnected && (
        <p className="mt-5 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">Instagram account disconnected.</p>
      )}
      {igError && (
        <p className="mt-5 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {ERROR_MESSAGES[igError] ?? `Connection failed: ${igError}`}
        </p>
      )}

      {!account ? (
        <div className="card mt-6 border-dashed p-10 text-center text-sm text-muted-foreground">
          No accounts connected yet. Connect a Business or Creator account linked to a Facebook Page.
          <p className="mt-3 text-xs">
            In Meta dev mode, only the app owner and whitelisted test accounts can connect.
          </p>
        </div>
      ) : (
        <>
          {/* Stats (default account) */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stats.map((s) => {
              const body = (
                <>
                  <div className="text-[12.5px] font-semibold text-muted-foreground">{s.label}</div>
                  <div className="font-display text-2xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.sub}</div>
                </>
              );
              return s.href ? (
                <Link key={s.label} href={s.href} className="card flex flex-col gap-1 p-4 transition hover:bg-muted/50">
                  {body}
                </Link>
              ) : (
                <div key={s.label} className="card flex flex-col gap-1 p-4">
                  {body}
                </div>
              );
            })}
          </div>

          {/* Shortcuts to this account's tools */}
          <div className="mt-4 flex flex-wrap gap-2">
            {TOOLS.map((t) => (
              <Link
                key={t.path}
                href={`/dashboard/accounts/${account.id}/${t.path}`}
                className="rounded-full border border-border px-3.5 py-1.5 text-[13px] font-medium transition hover:bg-muted"
              >
                {t.label}
              </Link>
            ))}
          </div>

          {/* Full live details (streams in; the rest of the page doesn't wait on Instagram) */}
          <div className="mt-6">
            <Suspense fallback={<DetailsSkeleton />}>
              <AccountDetails account={account} isDefault userId={user!.id} />
            </Suspense>
          </div>

          {/* Recent activity (default account) */}
          <section className="card mt-6 flex flex-col gap-3.5 p-5">
            <h2 className="text-[15px] font-bold">Recent activity</h2>
            {posts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No posts generated for @{username} yet.</p>
            ) : (
              posts.slice(0, 8).map((p) => (
                <div key={p.id} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] text-muted-foreground">
                    {p.status === "published" ? "✓" : p.status === "qa_failed" || p.status === "skipped" ? "✕" : "•"}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-[13px] leading-snug">{p.headline ?? "Untitled post"} — {p.status}</span>
                    <span className="text-[11.5px] text-muted-foreground">
                      {p.origin} · <LocalTime iso={p.created_at} />
                    </span>
                  </div>
                </div>
              ))
            )}
          </section>

          {list.length > 1 && (
            <p className="mt-4 text-xs text-muted-foreground">
              Showing your default account only. Your {list.length - 1} other account
              {list.length > 2 ? "s are" : " is"} in the sidebar account switcher — open one and choose
              &ldquo;Set as default&rdquo; to show it here instead.
            </p>
          )}
        </>
      )}
    </main>
  );
}
