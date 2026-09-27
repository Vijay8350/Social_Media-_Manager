import Link from "next/link";
import {
  decryptSecret,
  type CommentSettings,
  type IgComment,
  type InstagramAccount,
} from "@insta/shared";
import { createClient } from "@/lib/supabase/server";
import { isInstagramConfigured } from "@/lib/instagram-config";
import { inspectToken, COMMENT_SCOPE, type CheckState } from "@/lib/api-status";
import { isMissingSchema, MIGRATION_0005_HINT } from "@/lib/db-errors";
import { getDefaultAccountId, resolveDefaultAccount } from "@/lib/default-account";
import { StatusDot } from "@/components/StatusDot";
import {
  approveComment,
  checkCommentsNow,
  keepHidden,
  removeComment,
  saveCommentSettings,
  sendReply,
  skipComment,
} from "./actions";
import { CommentSettingsForm } from "./CommentSettingsForm";
import { ConfirmSubmit } from "./ConfirmSubmit";

type Account = Pick<InstagramAccount, "id" | "ig_username" | "ig_user_id" | "encrypted_token" | "status">;
type Readiness = { login: { state: CheckState; label: string }; permission: { state: CheckState; label: string } };

const TABS = [
  { id: "flagged", label: "Flagged", statuses: ["flagged"] },
  { id: "drafts", label: "Drafts", statuses: ["draft", "error"] },
  { id: "replied", label: "Replied", statuses: ["replied", "replying"] },
  { id: "all", label: "All", statuses: null },
] as const;
type TabId = (typeof TABS)[number]["id"];

const VERDICT_STYLE: Record<string, string> = {
  bad: "bg-red-500/10 text-red-600 dark:text-red-400",
  question: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  positive: "bg-green-500/10 text-green-700 dark:text-green-400",
  neutral: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  new: "Waiting for review",
  done: "No reply needed",
  approved: "Approved · unhidden",
  reviewed: "Reviewed · kept hidden",
  deleted: "Deleted",
  replying: "Sending… if this persists, check the post on Instagram",
};

const btn = "rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold transition hover:bg-muted";

async function readiness(acct: Account): Promise<Readiness> {
  const unknown = { state: "off" as const, label: "Unknown" };
  if (!acct.encrypted_token || !isInstagramConfigured()) {
    return { login: { state: "error", label: "No token" }, permission: unknown };
  }
  try {
    const t = await inspectToken(decryptSecret(acct.encrypted_token));
    return {
      login: t.valid ? { state: "ok", label: "Valid" } : { state: "error", label: "Invalid" },
      permission: t.scopes.includes(COMMENT_SCOPE)
        ? { state: "ok", label: "Granted" }
        : { state: "error", label: "Missing" },
    };
  } catch {
    return { login: { state: "error", label: "Check failed" }, permission: unknown };
  }
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function CommentCard({ c, account }: { c: IgComment; account: string | null }) {
  return (
    <div className="card flex flex-col gap-2.5 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <span className="font-semibold text-foreground">@{c.author ?? "someone"}</span>
        <span>· {when(c.commented_at)}</span>
        {account && <span>· on @{account}</span>}
        {c.media_permalink && (
          <a href={c.media_permalink} target="_blank" rel="noreferrer" className="hover:underline">
            · view post ↗
          </a>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {c.hidden && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Hidden</span>}
          {c.verdict && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${VERDICT_STYLE[c.verdict] ?? ""}`}>
              {c.verdict === "bad" ? `bad · ${c.category ?? "other"}` : c.verdict}
              {c.confidence != null && ` · ${Math.round(Number(c.confidence) * 100)}%`}
            </span>
          )}
        </span>
      </div>

      <p className="whitespace-pre-line text-sm">{c.text}</p>
      {c.reason && <p className="text-xs text-muted-foreground">AI: {c.reason}</p>}
      {c.error && <p className="text-xs text-red-600">{c.error}</p>}

      {c.status === "flagged" && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <form action={approveComment.bind(null, c.id)}>
            <button className={btn}>{c.hidden ? "✓ Unhide — it's fine" : "✓ It's fine"}</button>
          </form>
          <form action={keepHidden.bind(null, c.id)}>
            <button className={btn}>{c.hidden ? "Keep hidden" : "Hide it"}</button>
          </form>
          <form action={removeComment.bind(null, c.id)}>
            <ConfirmSubmit message="Delete this comment from Instagram? This can't be undone." className={`${btn} text-red-600`}>
              Delete
            </ConfirmSubmit>
          </form>
        </div>
      )}

      {(c.status === "draft" || c.status === "error") && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <form action={sendReply.bind(null, c.id)} className="flex flex-col gap-2">
            <textarea
              name="reply"
              defaultValue={c.reply_text ?? ""}
              rows={2}
              maxLength={1000}
              placeholder="Write a reply…"
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button className="btn-primary text-[13px]">Send reply</button>
            </div>
          </form>
          <form action={skipComment.bind(null, c.id)}>
            <button className="text-[12.5px] text-muted-foreground hover:underline">Skip — don&apos;t reply</button>
          </form>
        </div>
      )}

      {c.status === "replied" && (
        <p className="border-l-2 border-accent pl-3 text-sm">
          ↳ {c.reply_text}
          <span className="block text-[11.5px] text-muted-foreground">Replied {when(c.replied_at)}</span>
        </p>
      )}

      {STATUS_LABEL[c.status] && <p className="text-[12px] text-muted-foreground">{STATUS_LABEL[c.status]}</p>}
    </div>
  );
}

/** Comments admin: moderation queue for bad comments + AI reply drafts, per account. */
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

  const [{ data: acctRows }, savedDefault] = await Promise.all([
    supabase
      .from("instagram_accounts")
      .select("id, ig_username, ig_user_id, encrypted_token, status")
      .order("created_at", { ascending: true }),
    user ? getDefaultAccountId(supabase, user.id) : Promise.resolve(null),
  ]);
  const accounts = (acctRows ?? []) as Account[];
  const defaultAccount = resolveDefaultAccount(accounts, savedDefault);
  // Opens on the default account; ?account= (from an account's Overview) shows another one.
  const selected = accounts.find((a) => a.id === sp.account) ?? defaultAccount;
  const isDefault = selected?.id === defaultAccount?.id;
  const handle = (a: Account | null) => a?.ig_username ?? a?.ig_user_id ?? "account";
  const tab: TabId = TABS.some((t) => t.id === sp.tab) ? (sp.tab as TabId) : "flagged";
  const href = (t: TabId) => {
    const p = new URLSearchParams();
    if (selected && !isDefault) p.set("account", selected.id);
    p.set("tab", t);
    return `/dashboard/comments?${p}`;
  };

  // Only the selected (default) account's settings, counts and comments are loaded.
  let missing = false;
  let settings: CommentSettings | null = null;
  let counts: Record<string, number> = {};
  let comments: IgComment[] = [];
  if (selected) {
    const { data: s, error: settingsErr } = await supabase
      .from("comment_settings")
      .select("*")
      .eq("account_id", selected.id)
      .maybeSingle();
    missing = isMissingSchema(settingsErr);
    settings = (s as CommentSettings | null) ?? null;
  }
  if (selected && !missing) {
    const countOf = async (status: string) =>
      (
        await supabase
          .from("ig_comments")
          .select("id", { count: "exact", head: true })
          .eq("account_id", selected.id)
          .eq("status", status)
      ).count ?? 0;
    const [flagged, drafts] = await Promise.all([countOf("flagged"), countOf("draft")]);
    counts = { flagged, drafts };

    const statuses = TABS.find((t) => t.id === tab)!.statuses;
    let q = supabase.from("ig_comments").select("*").eq("account_id", selected.id);
    if (statuses) q = q.in("status", [...statuses]);
    const { data } = await q.order("commented_at", { ascending: false }).limit(100);
    comments = (data ?? []) as IgComment[];
  }

  const ready = selected ? await readiness(selected) : null;

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="text-2xl font-bold tracking-tight">Comments</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        AI replies in each account&apos;s voice, and a review queue for bad comments.
      </p>

      {missing && <div className="card mt-6 border-red-500/40 p-4 text-sm text-red-600">{MIGRATION_0005_HINT}</div>}

      {!selected && (
        <div className="card mt-6 border-dashed p-8 text-center text-sm text-muted-foreground">
          Connect an Instagram account to manage its comments here.
        </div>
      )}

      {/* Which account (the default, unless opened from another account's Overview) */}
      {selected && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-accent bg-accent-soft px-3.5 py-1.5 text-[13px] font-semibold text-accent">
            @{handle(selected)}
          </span>
          {isDefault ? (
            <span className="text-xs text-muted-foreground">★ Default account</span>
          ) : (
            <Link href="/dashboard/comments" className="text-xs text-muted-foreground hover:underline">
              ← Back to your default account (@{handle(defaultAccount)})
            </Link>
          )}
        </div>
      )}

      {/* Settings for the selected account */}
      {selected && !missing && (
        <section className="card mt-4 flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-bold">@{selected.ig_username ?? "account"} · comment automation</h2>
              <p className="text-xs text-muted-foreground">
                {settings
                  ? `On · checked every 15 minutes · last check ${when(settings.last_checked_at)}`
                  : "Off — save to start monitoring this account's comments."}
              </p>
            </div>
            {ready && (
              <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  Instagram login <StatusDot state={ready.login.state} label={ready.login.label} />
                </span>
                <span className="flex items-center gap-2">
                  Comments permission <StatusDot state={ready.permission.state} label={ready.permission.label} />
                </span>
              </div>
            )}
          </div>
          {ready && (ready.login.state !== "ok" || ready.permission.state !== "ok") && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-[13px] text-red-600">
              Comments can&apos;t be read or answered until this account has a valid login with the{" "}
              <code>{COMMENT_SCOPE}</code> permission —{" "}
              <a href="/api/instagram/connect" className="font-semibold underline">
                reconnect it
              </a>
              .
            </p>
          )}
          {settings?.last_error && (
            <p className="rounded-md bg-red-500/10 px-3 py-2 text-[13px] text-red-600">Last check failed: {settings.last_error}</p>
          )}
          <CommentSettingsForm
            key={settings?.updated_at ?? "new"}
            saveAction={saveCommentSettings.bind(null, selected.id)}
            checkAction={checkCommentsNow.bind(null, selected.id)}
            enabled={Boolean(settings)}
            replyMode={settings?.reply_mode ?? "review"}
            autoHide={settings?.auto_hide ?? true}
            dailyLimit={settings?.daily_reply_limit ?? 30}
          />
        </section>
      )}

      {/* Queue */}
      {selected && !missing && (
        <>
          <nav className="mt-6 flex gap-4 border-b border-border text-sm">
            {TABS.map((t) => {
              const n = t.id === "flagged" ? counts.flagged : t.id === "drafts" ? counts.drafts : undefined;
              return (
                <Link
                  key={t.id}
                  href={href(t.id)}
                  className={`-mb-px border-b-2 pb-2 ${tab === t.id ? "border-accent font-semibold text-foreground" : "border-transparent text-muted-foreground hover:border-muted-foreground"}`}
                >
                  {t.label}
                  {n ? (
                    <span className="ml-1.5 rounded-full bg-accent-soft px-1.5 py-0.5 text-[11px] font-bold text-accent">{n}</span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-4 flex flex-col gap-3">
            {comments.length === 0 ? (
              <div className="card border-dashed p-8 text-center text-sm text-muted-foreground">
                {tab === "flagged"
                  ? "No flagged comments. Bad comments the AI catches show up here for you to review."
                  : tab === "drafts"
                    ? "No reply drafts waiting. In Review mode, AI-drafted replies wait here for your OK."
                    : "Nothing here yet."}
              </div>
            ) : (
              comments.map((c) => <CommentCard key={c.id} c={c} account={null} />)
            )}
          </div>
        </>
      )}
    </main>
  );
}
