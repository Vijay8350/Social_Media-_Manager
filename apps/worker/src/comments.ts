import {
  createServiceRoleClient,
  decryptSecret,
  getActiveBusinessDna,
  getLLMProviderForUser,
  runCommentCycle,
  type AccountDna,
  type CommentSettings,
} from "@insta/shared";
import { loadPaidUsers } from "./scheduler.js";

/**
 * Comments sweep (every 15 min): for each account with comment monitoring on,
 * pull new comments, review them, hide + flag bad ones and draft/send replies.
 * Service role, so every query is scoped by user_id.
 */
export async function sweepComments(): Promise<number> {
  const svc = createServiceRoleClient();
  const { data, error } = await svc.from("comment_settings").select("*");
  if (error) {
    // Table missing until migration 0005 is applied — nothing to do yet.
    if (!/comment_settings/.test(error.message)) console.error("[comments] settings lookup failed:", error.message);
    return 0;
  }
  const active = ((data ?? []) as CommentSettings[]).filter((s) => s.reply_mode !== "off" || s.auto_hide);
  if (!active.length) return 0;

  const paidUsers = await loadPaidUsers(svc);
  let handled = 0;

  for (const s of active) {
    if (paidUsers && !paidUsers.has(s.user_id)) continue;
    const { data: account } = await svc
      .from("instagram_accounts")
      .select("id, user_id, ig_user_id, ig_username, encrypted_token, status")
      .eq("id", s.account_id)
      .eq("user_id", s.user_id)
      .maybeSingle();
    if (!account || account.status !== "connected" || !account.ig_user_id || !account.encrypted_token) continue;

    const fail = (message: string) =>
      svc
        .from("comment_settings")
        .update({ last_checked_at: new Date().toISOString(), last_error: message })
        .eq("account_id", s.account_id)
        .eq("user_id", s.user_id);

    let llm;
    let token: string;
    try {
      llm = await getLLMProviderForUser(svc, s.user_id);
      token = decryptSecret(account.encrypted_token as string);
    } catch (err) {
      await fail(err instanceof Error ? err.message : "configuration problem");
      continue;
    }

    const [{ data: dnaRow }, business] = await Promise.all([
      svc.from("account_dna").select("*").eq("account_id", s.account_id).eq("user_id", s.user_id).maybeSingle(),
      getActiveBusinessDna(svc, s.account_id, s.user_id),
    ]);

    const r = await runCommentCycle({
      client: svc,
      userId: s.user_id,
      account: { id: account.id, ig_user_id: account.ig_user_id, ig_username: account.ig_username },
      token,
      settings: s,
      llm,
      dna: (dnaRow as AccountDna | null) ?? null,
      business,
    });
    handled += r.reviewed;

    if (r.error || r.reviewed) {
      try {
        await svc.from("jobs_log").insert({
          user_id: s.user_id,
          account_id: s.account_id,
          stage: "comments",
          level: r.error ? "warn" : "info",
          message: r.error
            ? `comments: ${r.error}`
            : `comments: reviewed ${r.reviewed}, flagged ${r.flagged} (hidden ${r.hidden}), replied ${r.replied}, drafts ${r.drafted}`,
          context: {},
        });
      } catch {
        /* logging must never break the sweep */
      }
    }
  }
  return handled;
}
