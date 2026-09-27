import type { SupabaseClient } from "@supabase/supabase-js";
import type { LLMProvider } from "./providers/llm";
import { fetchRecentComments, replyToComment, setCommentHidden } from "./providers/instagram";
import type { AccountDna, BusinessDna, CommentSettings, IgComment } from "./types";

/**
 * Comments engine — shared by the worker's sweep and the dashboard's "Check now".
 * Works with the service role (worker) or an RLS session (web); every query is
 * scoped by user_id either way.
 */

/** Only comments this recent are picked up, so switching it on never replies to a backlog. */
export const COMMENT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const REVIEW_BATCH = 15;
/** Hide automatically only when the model is this sure a comment is bad. */
const HIDE_CONFIDENCE = 0.8;
/** Send automatically only when the model is this sure of its read of the comment. */
const AUTO_REPLY_CONFIDENCE = 0.7;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export interface CommentCycleInput {
  client: SupabaseClient;
  userId: string;
  account: { id: string; ig_user_id: string; ig_username: string | null };
  /** Decrypted Page access token. */
  token: string;
  settings: Pick<CommentSettings, "reply_mode" | "auto_hide" | "daily_reply_limit">;
  llm: LLMProvider;
  dna: AccountDna | null;
  business: BusinessDna | null;
  /** Cap on comments reviewed this run (the rest wait for the next one). */
  maxReview?: number;
}

export interface CommentCycleResult {
  fetched: number;
  reviewed: number;
  flagged: number;
  hidden: number;
  drafted: number;
  replied: number;
  error: string | null;
}

/**
 * Post a reply under a comment exactly once. The row is claimed first
 * (new/draft/error → replying), so concurrent runs can't both send; if the
 * process dies after Instagram accepts the reply, the row stays "replying" and
 * is never re-sent automatically.
 */
export async function sendCommentReply(
  client: SupabaseClient,
  userId: string,
  row: Pick<IgComment, "id" | "ig_comment_id">,
  token: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const message = text.trim().slice(0, 1000);
  if (!message) return { ok: false, error: "The reply is empty." };
  const now = new Date().toISOString();
  const { data: claimed } = await client
    .from("ig_comments")
    .update({ status: "replying", reply_text: message, updated_at: now })
    .eq("id", row.id)
    .eq("user_id", userId)
    .in("status", ["new", "draft", "error"])
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "This comment was already handled." };

  try {
    const replyId = await replyToComment(row.ig_comment_id, token, message);
    await client
      .from("ig_comments")
      .update({ status: "replied", reply_ig_id: replyId, replied_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("user_id", userId);
    return { ok: true };
  } catch (err) {
    const error = errText(err);
    await client
      .from("ig_comments")
      .update({ status: "error", error, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("user_id", userId);
    return { ok: false, error };
  }
}

/**
 * One pass for one account: pull new comments, review them with the AI, hide +
 * flag bad ones, and draft or send replies per the account's settings. Never
 * throws for API/model problems — they're recorded on comment_settings.last_error.
 */
export async function runCommentCycle(input: CommentCycleInput): Promise<CommentCycleResult> {
  const { client, userId, account, token, settings, llm, dna, business } = input;
  const result: CommentCycleResult = { fetched: 0, reviewed: 0, flagged: 0, hidden: 0, drafted: 0, replied: 0, error: null };
  const own = account.ig_username?.toLowerCase();

  try {
    // 1) Pull recent top-level comments; store the ones we haven't seen.
    const since = new Date(Date.now() - COMMENT_LOOKBACK_MS);
    const comments = (await fetchRecentComments(account.ig_user_id, token, { since })).filter(
      (c) => !own || c.author?.toLowerCase() !== own,
    );
    result.fetched = comments.length;
    if (comments.length) {
      const { error } = await client.from("ig_comments").upsert(
        comments.map((c) => ({
          account_id: account.id,
          user_id: userId,
          ig_comment_id: c.id,
          ig_media_id: c.mediaId,
          media_permalink: c.permalink,
          media_caption: c.caption?.slice(0, 500) ?? null,
          author: c.author,
          text: c.text.slice(0, 2200),
          commented_at: c.timestamp,
          hidden: c.hidden,
        })),
        { onConflict: "account_id,ig_comment_id", ignoreDuplicates: true },
      );
      if (error) throw new Error(`Couldn't store comments: ${error.message}`);
    }

    // 2) Review what's still new, oldest first.
    const { data: pending, error: pendErr } = await client
      .from("ig_comments")
      .select("*")
      .eq("account_id", account.id)
      .eq("user_id", userId)
      .eq("status", "new")
      .order("commented_at", { ascending: true })
      .limit(input.maxReview ?? 60);
    if (pendErr) throw new Error(pendErr.message);
    const rows = (pending ?? []) as IgComment[];
    if (!rows.length) return result;

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: repliedToday } = await client
      .from("ig_comments")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .eq("user_id", userId)
      .eq("status", "replied")
      .gte("replied_at", dayAgo);
    let budget = Math.max(0, settings.daily_reply_limit - (repliedToday ?? 0));

    for (let i = 0; i < rows.length; i += REVIEW_BATCH) {
      const batch = rows.slice(i, i + REVIEW_BATCH);
      const reviews = await llm.reviewComments(
        batch.map((r) => ({ id: r.id, author: r.author, text: r.text, post: r.media_caption })),
        dna,
        business,
      );
      const byId = new Map(reviews.map((r) => [r.id, r]));

      for (const row of batch) {
        const review = byId.get(row.id);
        const now = new Date().toISOString();
        if (!review) {
          await client
            .from("ig_comments")
            .update({ status: "error", error: "The AI didn't return a verdict for this comment.", updated_at: now })
            .eq("id", row.id)
            .eq("user_id", userId);
          continue;
        }
        result.reviewed++;
        const verdict = {
          verdict: review.verdict,
          category: review.category,
          reason: review.reason,
          confidence: review.confidence,
          reply_text: review.reply,
          updated_at: now,
        };

        // 3a) Bad → flag for review; hide on Instagram when we're confident.
        if (review.verdict === "bad") {
          let hidden = row.hidden;
          let error: string | null = null;
          if (settings.auto_hide && !hidden && review.confidence >= HIDE_CONFIDENCE) {
            try {
              await setCommentHidden(row.ig_comment_id, token, true);
              hidden = true;
              result.hidden++;
            } catch (err) {
              error = `Couldn't hide: ${errText(err)}`;
            }
          }
          await client
            .from("ig_comments")
            .update({ ...verdict, status: "flagged", hidden, error })
            .eq("id", row.id)
            .eq("user_id", userId);
          result.flagged++;
          continue;
        }

        // 3b) Fine → reply per mode (auto only within the daily limit and when confident).
        const canAuto =
          settings.reply_mode === "auto" && review.reply && budget > 0 && review.confidence >= AUTO_REPLY_CONFIDENCE;
        const status = review.reply && settings.reply_mode !== "off" ? "draft" : "done";
        await client
          .from("ig_comments")
          .update({ ...verdict, status: canAuto ? "new" : status })
          .eq("id", row.id)
          .eq("user_id", userId);
        if (canAuto) {
          const sent = await sendCommentReply(client, userId, row, token, review.reply!);
          if (sent.ok) {
            budget--;
            result.replied++;
          }
        } else if (status === "draft") {
          result.drafted++;
        }
      }
    }
  } catch (err) {
    result.error = errText(err);
  } finally {
    await client
      .from("comment_settings")
      .update({ last_checked_at: new Date().toISOString(), last_error: result.error })
      .eq("account_id", account.id)
      .eq("user_id", userId);
  }
  return result;
}
