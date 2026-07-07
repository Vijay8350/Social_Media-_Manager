import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isInstagramConfigured } from "@/lib/instagram-config";
import type { InstagramAccount, Post } from "@insta/shared";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Instagram isn't configured yet — add FACEBOOK_APP_ID / FACEBOOK_APP_SECRET to your env.",
  invalid_state: "The connection request expired or was tampered with. Please try again.",
  no_pages: "No Facebook Pages were found. You need a Page linked to an Instagram Business/Creator account.",
  no_business_account: "That Page has no linked Instagram Business or Creator account.",
  save_failed: "Couldn't save the connection. Please try again.",
  not_found: "That account no longer exists.",
};

const AVATAR_BG = ["#3D3548", "#2E4B3F", "#5A4632", "#3A3550", "#4A3340"];

function statusLabel(status: InstagramAccount["status"]): string {
  switch (status) {
    case "connected": return "Connected";
    case "needs_reauth": return "Needs re-authentication";
    case "ineligible": return "Ineligible (no linked IG Business account)";
    default: return "Disconnected";
  }
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

  const [{ data: accounts }, { data: postRows }] = await Promise.all([
    supabase.from("instagram_accounts").select("*").order("created_at", { ascending: true }),
    supabase.from("posts").select("id, headline, status, origin, created_at, account_id").order("created_at", { ascending: false }).limit(40),
  ]);

  const list = (accounts ?? []) as InstagramAccount[];
  const posts = (postRows as Pick<Post, "id" | "headline" | "status" | "origin" | "created_at" | "account_id">[] | null) ?? [];
  const weekAgo = Date.now() - 7 * 864e5;
  const thisWeek = posts.filter((p) => new Date(p.created_at).getTime() > weekAgo);
  const published = posts.filter((p) => p.status === "published").length;
  const blocked = posts.filter((p) => p.status === "qa_failed" || p.status === "skipped").length;

  const sp = await searchParams;
  const igError = typeof sp.ig_error === "string" ? sp.ig_error : null;
  const igConnected = typeof sp.ig_connected === "string" ? Number(sp.ig_connected) : 0;
  const igDisconnected = sp.ig_disconnected === "1";

  const stats = [
    { label: "Accounts connected", value: String(list.length), sub: `${list.length} active`, ok: false },
    { label: "Posts this week", value: String(thisWeek.length), sub: "generated", ok: true },
    { label: "Published", value: String(published), sub: "live on Instagram", ok: true },
    { label: "Blocked & skipped", value: String(blocked), sub: "never published on fail", ok: false },
  ];

  const configured = isInstagramConfigured();

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {user?.email}</p>
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

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card flex flex-col gap-1 p-4">
            <div className="text-[12.5px] font-semibold text-muted-foreground">{s.label}</div>
            <div className="font-display text-2xl font-bold">{s.value}</div>
            <div className={`text-xs ${s.ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Connected accounts */}
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[15px] font-bold">Connected accounts</h2>
          {list.length === 0 ? (
            <div className="card border-dashed p-8 text-center text-sm text-muted-foreground">
              No accounts connected yet. Connect a Business or Creator account linked to a Facebook Page.
            </div>
          ) : (
            list.map((acct, i) => (
              <div key={acct.id} className="card flex items-center gap-3.5 p-4">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full text-base font-bold text-white"
                  style={{ background: AVATAR_BG[i % AVATAR_BG.length] }}
                >
                  {(acct.ig_username?.[0] ?? "@").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">@{acct.ig_username ?? acct.ig_user_id ?? "unknown"}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {statusLabel(acct.status)}
                    {acct.token_expiry ? ` · token to ${new Date(acct.token_expiry).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <Link
                  href={`/dashboard/accounts/${acct.id}/dna`}
                  className="rounded-lg border border-border px-3.5 py-1.5 text-[13px] font-semibold transition hover:bg-muted"
                >
                  Open
                </Link>
              </div>
            ))
          )}
          {configured && (
            <a
              href="/api/instagram/connect"
              className="card border-dashed p-3.5 text-center text-[13.5px] text-muted-foreground transition hover:bg-muted"
            >
              ＋ Connect Instagram account
            </a>
          )}
        </section>

        {/* Recent activity */}
        <section className="card flex flex-col gap-3.5 p-5">
          <h2 className="text-[15px] font-bold">Recent activity</h2>
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No posts generated yet.</p>
          ) : (
            posts.slice(0, 6).map((p) => (
              <div key={p.id} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] text-muted-foreground">
                  {p.status === "published" ? "✓" : p.status === "qa_failed" || p.status === "skipped" ? "✕" : "•"}
                </span>
                <div className="flex flex-col">
                  <span className="text-[13px] leading-snug">{p.headline ?? "Untitled post"} — {p.status}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {p.origin} · {new Date(p.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </section>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Requires an Instagram Business or Creator account linked to a Facebook Page. In Meta dev mode, only the app owner and whitelisted test accounts can connect.
      </p>
    </main>
  );
}
