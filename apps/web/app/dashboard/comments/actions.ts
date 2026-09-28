"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isMissingSchema, MIGRATION_0005_HINT } from "@/lib/db-errors";
import {
  decryptSecret,
  deleteComment,
  getActiveBusinessDna,
  getLLMProviderForUser,
  runCommentCycle,
  sendCommentReply,
  setCommentHidden,
  type AccountDna,
  type CommentReplyMode,
  type IgComment,
} from "@insta/shared";

export type CommentsState = { ok?: boolean; message?: string; error?: string } | undefined;

type Supabase = Awaited<ReturnType<typeof createClient>>;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const MODES: CommentReplyMode[] = ["off", "review", "auto"];

async function session() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** The user's account with a decrypted token, or an error message. */
async function ownedAccount(supabase: Supabase, userId: string, accountId: string) {
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id, ig_user_id, ig_username, encrypted_token, status")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!account) return { error: "Account not found" } as const;
  if (!account.ig_user_id || !account.encrypted_token) {
    return { error: "This account has no Instagram login stored — reconnect it." } as const;
  }
  try {
    return { account, token: decryptSecret(account.encrypted_token) } as const;
  } catch {
    return { error: "The stored Instagram login can't be read — reconnect the account." } as const;
  }
}

/** A comment the user owns, plus its account token. */
async function ownedComment(supabase: Supabase, userId: string, commentId: string) {
  const { data } = await supabase
    .from("ig_comments")
    .select("*")
    .eq("id", commentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { error: "Comment not found" } as const;
  const row = data as IgComment;
  const acct = await ownedAccount(supabase, userId, row.account_id);
  if ("error" in acct) return { error: acct.error } as const;
  return { row, token: acct.token } as const;
}

async function markError(supabase: Supabase, userId: string, id: string, error: string) {
  await supabase
    .from("ig_comments")
    .update({ error: error.slice(0, 300), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
}

/** Refresh every view of comments: /dashboard/comments, each account's Comments tab, the sidebar badge. */
function done() {
  revalidatePath("/dashboard", "layout");
}

/** Save an account's comment settings (creating the row switches monitoring on). */
export async function saveCommentSettings(
  accountId: string,
  _prev: CommentsState,
  formData: FormData,
): Promise<CommentsState> {
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };

  const mode = String(formData.get("reply_mode") ?? "review") as CommentReplyMode;
  if (!MODES.includes(mode)) return { error: "Pick a reply mode." };
  const limit = Math.round(Number(formData.get("daily_reply_limit") ?? 30));
  if (!Number.isFinite(limit) || limit < 0 || limit > 200) {
    return { error: "Daily reply limit must be between 0 and 200." };
  }

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) return { error: "Account not found" };

  const { error } = await supabase.from("comment_settings").upsert(
    {
      account_id: accountId,
      user_id: user.id,
      reply_mode: mode,
      auto_hide: formData.get("auto_hide") === "on",
      daily_reply_limit: limit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "account_id" },
  );
  if (error) return { error: isMissingSchema(error) ? MIGRATION_0005_HINT : error.message };
  done();
  return { ok: true, message: "Saved ✓" };
}

/** Run one comments pass for an account right now (same engine as the worker). */
export async function checkCommentsNow(
  accountId: string,
  _prev: CommentsState,
  _formData: FormData,
): Promise<CommentsState> {
  const { supabase, user } = await session();
  if (!user) return { error: "Not signed in" };

  const { data: settings, error: sErr } = await supabase
    .from("comment_settings")
    .select("*")
    .eq("account_id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (sErr) return { error: isMissingSchema(sErr) ? MIGRATION_0005_HINT : sErr.message };
  if (!settings) return { error: "Save the settings first to switch comment monitoring on." };

  const acct = await ownedAccount(supabase, user.id, accountId);
  if ("error" in acct) return { error: acct.error };

  let llm;
  try {
    llm = await getLLMProviderForUser(supabase, user.id);
  } catch (err) {
    return { error: errMsg(err) };
  }
  const [{ data: dnaRow }, business] = await Promise.all([
    supabase.from("account_dna").select("*").eq("account_id", accountId).maybeSingle(),
    getActiveBusinessDna(supabase, accountId, user.id),
  ]);

  const r = await runCommentCycle({
    client: supabase,
    userId: user.id,
    account: { id: acct.account.id, ig_user_id: acct.account.ig_user_id!, ig_username: acct.account.ig_username },
    token: acct.token,
    settings,
    llm,
    dna: (dnaRow as AccountDna | null) ?? null,
    business,
    maxReview: 15, // one AI batch, so the request finishes well inside the proxy timeout
  });
  done();
  if (r.error) return { error: r.error };
  return {
    ok: true,
    message: r.reviewed
      ? `Reviewed ${r.reviewed} new comment${r.reviewed === 1 ? "" : "s"}: ${r.flagged} flagged (${r.hidden} hidden), ${r.replied} replied, ${r.drafted} drafts.`
      : `No new comments in the last 3 days (${r.fetched} seen).`,
  };
}

/** Send a (possibly edited) draft reply. */
export async function sendReply(commentId: string, formData: FormData): Promise<void> {
  const { supabase, user } = await session();
  if (!user) return;
  const c = await ownedComment(supabase, user.id, commentId);
  if ("error" in c) return;
  const text = String(formData.get("reply") ?? "");
  await sendCommentReply(supabase, user.id, c.row, c.token, text);
  done();
}

/** Don't reply to this one. */
export async function skipComment(commentId: string): Promise<void> {
  const { supabase, user } = await session();
  if (!user) return;
  await supabase
    .from("ig_comments")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("user_id", user.id)
    .in("status", ["new", "draft", "error"]);
  done();
}

/** Flagged → it's fine: unhide it on Instagram. */
export async function approveComment(commentId: string): Promise<void> {
  const { supabase, user } = await session();
  if (!user) return;
  const c = await ownedComment(supabase, user.id, commentId);
  if ("error" in c) return;
  try {
    if (c.row.hidden) await setCommentHidden(c.row.ig_comment_id, c.token, false);
    await supabase
      .from("ig_comments")
      .update({ status: "approved", hidden: false, error: null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", commentId)
      .eq("user_id", user.id);
  } catch (err) {
    await markError(supabase, user.id, commentId, `Couldn't unhide: ${errMsg(err)}`);
  }
  done();
}

/** Flagged → agree it's bad: hide it (if it isn't already) and close it. */
export async function keepHidden(commentId: string): Promise<void> {
  const { supabase, user } = await session();
  if (!user) return;
  const c = await ownedComment(supabase, user.id, commentId);
  if ("error" in c) return;
  try {
    if (!c.row.hidden) await setCommentHidden(c.row.ig_comment_id, c.token, true);
    await supabase
      .from("ig_comments")
      .update({ status: "reviewed", hidden: true, error: null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", commentId)
      .eq("user_id", user.id);
  } catch (err) {
    await markError(supabase, user.id, commentId, `Couldn't hide: ${errMsg(err)}`);
  }
  done();
}

/** Permanently delete the comment from Instagram. */
export async function removeComment(commentId: string): Promise<void> {
  const { supabase, user } = await session();
  if (!user) return;
  const c = await ownedComment(supabase, user.id, commentId);
  if ("error" in c) return;
  try {
    await deleteComment(c.row.ig_comment_id, c.token);
    await supabase
      .from("ig_comments")
      .update({ status: "deleted", error: null, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", commentId)
      .eq("user_id", user.id);
  } catch (err) {
    await markError(supabase, user.id, commentId, `Couldn't delete: ${errMsg(err)}`);
  }
  done();
}
