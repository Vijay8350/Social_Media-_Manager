import {
  createServiceRoleClient,
  decryptSecret,
  fetchMediaInsights,
} from "@insta/shared";

/**
 * Pull Instagram insights for recently-published posts and store a metrics
 * snapshot in post_metrics (Stage 6). Runs periodically; best-effort per post.
 */
export async function pullAnalytics(): Promise<number> {
  const svc = createServiceRoleClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const { data: posts } = await svc
    .from("posts")
    .select("id, user_id, account_id, ig_media_id")
    .eq("status", "published")
    .not("ig_media_id", "is", null)
    .gte("published_at", since);
  if (!posts?.length) return 0;

  // Cache decrypted tokens per account.
  const tokens = new Map<string, string | null>();
  let updated = 0;

  for (const post of posts) {
    try {
      let token = tokens.get(post.account_id);
      if (token === undefined) {
        const { data: acct } = await svc
          .from("instagram_accounts")
          .select("encrypted_token")
          .eq("id", post.account_id)
          .maybeSingle();
        token = acct?.encrypted_token ? decryptSecret(acct.encrypted_token) : null;
        tokens.set(post.account_id, token);
      }
      if (!token) continue;

      const m = await fetchMediaInsights(post.ig_media_id as string, token);
      await svc.from("post_metrics").insert({
        post_id: post.id,
        user_id: post.user_id,
        likes: m.likes,
        reach: m.reach,
        saves: m.saves,
        comments: m.comments,
      });
      updated++;
    } catch {
      /* best-effort per post */
    }
  }
  return updated;
}
