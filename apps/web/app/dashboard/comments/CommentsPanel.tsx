import Link from "next/link";
import {
  decryptSecret,
  fetchRecentComments,
  type CommentSettings,
  type IgComment,
  type InstagramAccount,
  type MediaComment,
} from "@insta/shared";
import { createClient } from "@/lib/supabase/server";
import { isInstagramConfigured } from "@/lib/instagram-config";
import { inspectToken, COMMENT_SCOPE, type CheckState } from "@/lib/api-status";
import { isMissingSchema, MIGRATION_0005_HINT } from "@/lib/db-errors";
import { StatusDot } from "@/components/StatusDot";
import { LocalTime } from "@/components/LocalTime";
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

export type CommentsAccount = Pick<
  InstagramAccount,
  "id" | "ig_username" | "ig_user_id" | "encrypted_token" | "status"
>;
type Readiness = { login: { state: CheckState; label: string }; permission: { state: CheckState; label: string } };

/** "recent" is read live from Instagram; the rest are the automation's queues (ig_comments). */
const TABS = [
  { id: "recent", label: "Recent", statuses: null },
  { id: "flagged", label: "Flagged", statuses: ["flagged"] },
  { id: "drafts", label: "Drafts", statuses: ["draft", "error"] },
  { id: "replied", label: "Replied", statuses: ["replied", "replying"] },
  { id: "all", label: "All reviewed", statuses: null },
] as const;
type TabId = (typeof TABS)[number]["id"];

const RECENT_POSTS = 12;
const PER_POST = 25;
const MAX_RECENT = 100;

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

async function readiness(acct: CommentsAccount): Promise<Readiness> {
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

// One fetch is 1 + N Graph calls (media list + one per post with comments), so
// results are reused for a minute per account to stay clear of rate limits.
// Only successes are cached, so a reconnect shows up immediately.
const LIVE_TTL_MS = 60_000;
const liveCache = new Map<string, { at: number; comments: MediaComment[] }>();

/** The account's latest top-level comments, straight from Instagram (newest first). */
async function liveComments(acct: CommentsAccount): Promise<{ comments: MediaComment[]; error: string | null }> {
  if (!acct.ig_user_id || !acct.encrypted_token) return { comments: [], error: "No Instagram login stored for this account." };
  const hit = liveCache.get(acct.id);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return { comments: hit.comments, error: null };
  try {
    const all = await fetchRecentComments(acct.ig_user_id, decryptSecret(acct.encrypted_token), {
      since: new Date(0),
      mediaLimit: RECENT_POSTS,
      perMedia: PER_POST,
    });
    // Skip the account's own comments (e.g. hashtag comments), as the automation does.
    const own = acct.ig_username?.toLowerCase();
    const comments = all
      .filter((c) => !own || c.author?.toLowerCase() !== own)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, MAX_RECENT);
    liveCache.delete(acct.id);
    liveCache.set(acct.id, { at: Date.now(), comments });
    if (liveCache.size > 500) liveCache.delete(liveCache.keys().next().value!);
    return { comments, error: null };
  } catch (err) {
    return { comments: [], error: err instanceof Error ? err.message : "Instagram request failed" };
  }
}

function when(iso: string | null): React.ReactNode {
  return iso ? <LocalTime iso={iso} /> : "—";
}

/** Shorten by code point, so an emoji is never split (a lone surrogate breaks hydration). */
function snippet(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

function VerdictBadge({ c }: { c: Pick<IgComment, "verdict" | "category" | "confidence"> }) {
  if (!c.verdict) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${VERDICT_STYLE[c.verdict] ?? ""}`}>
      {c.verdict === "bad" ? `bad · ${c.category ?? "other"}` : c.verdict}
      {c.confidence != null && ` · ${Math.round(Number(c.confidence) * 100)}%`}
    </span>
  );
}

function CommentCard({ c }: { c: IgComment }) {
  return (
    <div className="card flex flex-col gap-2.5 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <span className="font-semibold text-foreground">@{c.author ?? "someone"}</span>
        <span>· {when(c.commented_at)}</span>
        {c.media_permalink && (
          <a href={c.media_permalink} target="_blank" rel="noreferrer" className="hover:underline">
            · view post ↗
          </a>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {c.hidden && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Hidden</span>}
          <VerdictBadge c={c} />
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

/** A comment read live from Instagram, with the automation's verdict when it has reviewed it. */
function LiveCommentCard({ c, reviewed }: { c: MediaComment; reviewed: IgComment | undefined }) {
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
        <span className="font-semibold text-foreground">@{c.author ?? "someone"}</span>
        <span>· {when(c.timestamp)}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {c.hidden && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Hidden</span>}
          {reviewed && <VerdictBadge c={reviewed} />}
        </span>
      </div>
      <p className="whitespace-pre-line text-sm">{c.text}</p>
      {c.permalink && (
        <a
          href={c.permalink}
          target="_blank"
          rel="noreferrer"
          className="truncate text-[12px] text-muted-foreground hover:underline"
        >
          On: {c.caption ? `“${snippet(c.caption, 70)}”` : "this post"} ↗
        </a>
      )}
    </div>
  );
}

/**
 * One account's comments: automation settings, a live list of recent comments,
 * and the review queues. Used by /dashboard/comments and each account's
 * Comments tab; `baseHref` is where the tab links point.
 */
export async function CommentsPanel({
  account,
  tab: requested,
  baseHref,
}: {
  account: CommentsAccount;
  tab?: string;
  baseHref: string;
}) {
  const supabase = await createClient();
  const handle = account.ig_username ?? account.ig_user_id ?? "account";

  const { data: s, error: settingsErr } = await supabase
    .from("comment_settings")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle();
  if (isMissingSchema(settingsErr)) {
    return <div className="card border-red-500/40 p-4 text-sm text-red-600">{MIGRATION_0005_HINT}</div>;
  }
  const settings = (s as CommentSettings | null) ?? null;

  const countOf = async (status: string) =>
    (
      await supabase
        .from("ig_comments")
        .select("id", { count: "exact", head: true })
        .eq("account_id", account.id)
        .eq("status", status)
    ).count ?? 0;
  const [flagged, drafts] = await Promise.all([countOf("flagged"), countOf("draft")]);
  const counts: Partial<Record<TabId, number>> = { flagged, drafts };

  // Open on Flagged when something is waiting for review, otherwise on Recent.
  const tab: TabId = TABS.some((t) => t.id === requested)
    ? (requested as TabId)
    : flagged > 0
      ? "flagged"
      : "recent";
  const href = (t: TabId) => `${baseHref}${baseHref.includes("?") ? "&" : "?"}tab=${t}`;

  const ready = await readiness(account);
  const canRead = ready.login.state === "ok" && ready.permission.state === "ok";

  let queue: IgComment[] = [];
  let live: { comments: MediaComment[]; error: string | null } = { comments: [], error: null };
  const reviewed = new Map<string, IgComment>();

  if (tab === "recent") {
    if (canRead) {
      live = await liveComments(account);
      const ids = live.comments.map((c) => c.id);
      if (ids.length) {
        const { data } = await supabase
          .from("ig_comments")
          .select("*")
          .eq("account_id", account.id)
          .in("ig_comment_id", ids);
        for (const row of (data ?? []) as IgComment[]) reviewed.set(row.ig_comment_id, row);
      }
    }
  } else {
    const statuses = TABS.find((t) => t.id === tab)!.statuses;
    let q = supabase.from("ig_comments").select("*").eq("account_id", account.id);
    if (statuses) q = q.in("status", [...statuses]);
    const { data } = await q.order("commented_at", { ascending: false }).limit(100);
    queue = (data ?? []) as IgComment[];
  }

  return (
    <div className="flex flex-col">
      {/* Automation settings for this account */}
      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold">@{handle} · comment automation</h2>
            <p className="text-xs text-muted-foreground">
              {settings ? (
                <>On · checked every 15 minutes · last check {when(settings.last_checked_at)}</>
              ) : (
                "Off — save to start monitoring this account's comments."
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              Instagram login <StatusDot state={ready.login.state} label={ready.login.label} />
            </span>
            <span className="flex items-center gap-2">
              Comments permission <StatusDot state={ready.permission.state} label={ready.permission.label} />
            </span>
          </div>
        </div>
        {!canRead && (
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
          saveAction={saveCommentSettings.bind(null, account.id)}
          checkAction={checkCommentsNow.bind(null, account.id)}
          enabled={Boolean(settings)}
          replyMode={settings?.reply_mode ?? "review"}
          autoHide={settings?.auto_hide ?? true}
          dailyLimit={settings?.daily_reply_limit ?? 30}
        />
      </section>

      <nav className="mt-6 flex gap-4 overflow-x-auto border-b border-border text-sm">
        {TABS.map((t) => {
          const n = counts[t.id];
          return (
            <Link
              key={t.id}
              href={href(t.id)}
              className={`-mb-px shrink-0 border-b-2 pb-2 ${
                tab === t.id
                  ? "border-accent font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:border-muted-foreground"
              }`}
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
        {tab === "recent" ? (
          !canRead ? (
            <div className="card border-dashed p-8 text-center text-sm text-muted-foreground">
              Reconnect @{handle} with the comments permission to see its comments here.
            </div>
          ) : live.error ? (
            <div className="card border-red-500/40 p-4 text-sm text-red-600">
              Couldn&apos;t load comments from Instagram: {live.error}
            </div>
          ) : live.comments.length === 0 ? (
            <div className="card border-dashed p-8 text-center text-sm text-muted-foreground">
              No comments from people on @{handle}&apos;s latest {RECENT_POSTS} posts yet.
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Latest {live.comments.length} comments from people on @{handle}&apos;s {RECENT_POSTS} most recent posts,
                live from Instagram (your own comments aren&apos;t shown)
                {settings ? "" : " — turn on automation above to have the AI review and reply to them"}.
              </p>
              {live.comments.map((c) => (
                <LiveCommentCard key={c.id} c={c} reviewed={reviewed.get(c.id)} />
              ))}
            </>
          )
        ) : queue.length === 0 ? (
          <div className="card border-dashed p-8 text-center text-sm text-muted-foreground">
            {tab === "flagged"
              ? "No flagged comments. Bad comments the AI catches show up here for you to review."
              : tab === "drafts"
                ? "No reply drafts waiting. In Review mode, AI-drafted replies wait here for your OK."
                : "Nothing here yet — comments appear once automation has reviewed them."}
          </div>
        ) : (
          queue.map((c) => <CommentCard key={c.id} c={c} />)
        )}
      </div>
    </div>
  );
}
