import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDefaultAccountId, resolveDefaultAccount } from "@/lib/default-account";
import { CommentsPanel, type CommentsAccount } from "./CommentsPanel";

/**
 * Comments admin across accounts: pick an account from the strip (opens on the
 * default one), then its settings, live comments and review queues below.
 * Per-account flagged counts come from the database only — Instagram is only
 * called for the selected account.
 */
export default async function CommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: acctRows }, savedDefault, { data: flaggedRows }] = await Promise.all([
    supabase
      .from("instagram_accounts")
      .select("id, ig_username, ig_user_id, encrypted_token, status")
      .order("created_at", { ascending: true }),
    user ? getDefaultAccountId(supabase, user.id) : Promise.resolve(null),
    supabase.from("ig_comments").select("account_id").eq("status", "flagged").limit(2000),
  ]);
  const accounts = (acctRows ?? []) as CommentsAccount[];
  const defaultAccount = resolveDefaultAccount(accounts, savedDefault);
  const selected = accounts.find((a) => a.id === sp.account) ?? defaultAccount;

  const flaggedBy = new Map<string, number>();
  for (const r of flaggedRows ?? []) {
    const id = r.account_id as string;
    flaggedBy.set(id, (flaggedBy.get(id) ?? 0) + 1);
  }
  const hrefFor = (a: CommentsAccount) =>
    a.id === defaultAccount?.id ? "/dashboard/comments" : `/dashboard/comments?account=${a.id}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <h1 className="text-2xl font-bold tracking-tight">Comments</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Each account&apos;s latest comments, AI replies in its voice, and a review queue for bad comments.
      </p>

      {!selected ? (
        <div className="card mt-6 border-dashed p-8 text-center text-sm text-muted-foreground">
          Connect an Instagram account to manage its comments here.
        </div>
      ) : (
        <>
          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Instagram accounts">
            {accounts.map((a) => {
              const active = a.id === selected.id;
              const n = flaggedBy.get(a.id) ?? 0;
              return (
                <Link
                  key={a.id}
                  href={hrefFor(a)}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  @{a.ig_username ?? a.ig_user_id ?? "account"}
                  {a.id === defaultAccount?.id && (
                    <span className="text-xs" title="Default account">
                      ★
                    </span>
                  )}
                  {n > 0 && (
                    <span
                      className="rounded-full bg-red-500/15 px-1.5 text-[10.5px] font-bold text-red-600 dark:text-red-400"
                      title="Flagged comments waiting for review"
                    >
                      {n}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="mt-4">
            <CommentsPanel account={selected} tab={sp.tab} baseHref={hrefFor(selected)} />
          </div>
        </>
      )}
    </main>
  );
}
