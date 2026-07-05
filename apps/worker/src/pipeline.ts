import {
  createServiceRoleClient,
  getLLMProvider,
  getImageProvider,
  getVisionProvider,
  buildImagePrompt,
  normalizeHash,
  decryptSecret,
  publishImagePost,
  type AccountDna,
} from "@insta/shared";

const IMAGE_BUCKET = "post-images";
const MAX_REGEN_ATTEMPTS = Number(process.env.MAX_REGEN_ATTEMPTS) || 3;
const DAILY_LIMIT = 25;

type Svc = ReturnType<typeof createServiceRoleClient>;

async function log(
  svc: Svc,
  entry: {
    user_id: string;
    account_id: string;
    post_id?: string | null;
    stage: string;
    level: string;
    message: string;
    context?: Record<string, unknown>;
  },
) {
  try {
    await svc.from("jobs_log").insert({ context: {}, ...entry });
  } catch {
    /* logging must never break the pipeline */
  }
}

/**
 * Full autonomous pipeline for one account (Stages 1–5). Service-role client,
 * so every query is explicitly scoped by user_id. Idempotent per day: skips if
 * an auto post was already published today for this account.
 */
export async function runDailyPipeline(accountId: string, userId: string) {
  const svc = createServiceRoleClient();

  const { data: account } = await svc
    .from("instagram_accounts")
    .select("id, user_id, ig_user_id, ig_username, encrypted_token, status")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!account || account.status !== "connected") {
    await log(svc, { user_id: userId, account_id: accountId, stage: "start", level: "warn", message: "account not connected; skipping" });
    return;
  }

  // Idempotency: already published today?
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count: publishedToday } = await svc
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("origin", "auto")
    .eq("status", "published")
    .gte("published_at", startOfDay.toISOString());
  if ((publishedToday ?? 0) > 0) {
    await log(svc, { user_id: userId, account_id: accountId, stage: "start", level: "info", message: "already posted today; skipping" });
    return;
  }

  const { data: dnaRow } = await svc
    .from("account_dna")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  const dna = (dnaRow as AccountDna | null) ?? null;

  // Rotate an active quote-idea prompt (least recently used).
  const { data: quotePrompt } = await svc
    .from("prompt_library")
    .select("id, prompt_text, use_count")
    .eq("account_id", accountId)
    .eq("type", "quote_idea")
    .eq("active", true)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (!quotePrompt) {
    await log(svc, { user_id: userId, account_id: accountId, stage: "idea", level: "warn", message: "no active quote-idea prompt; skipping" });
    return;
  }

  const llm = getLLMProvider();
  const image = getImageProvider();
  const vision = getVisionProvider();

  try {
    // Stage 1 — idea (dedup).
    const { data: recent } = await svc
      .from("content_ideas")
      .select("idea")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(15);
    const recentSummaries = (recent ?? [])
      .map((r) => (r.idea as { summary?: string } | null)?.summary)
      .filter((s): s is string => Boolean(s));

    let idea = await llm.generateIdea(dna, quotePrompt.prompt_text, recentSummaries);
    let hash = normalizeHash(idea.summary);
    for (let i = 0; i < 3; i++) {
      const { data: dup } = await svc
        .from("content_ideas")
        .select("id")
        .eq("account_id", accountId)
        .eq("normalized_hash", hash)
        .maybeSingle();
      if (!dup) break;
      recentSummaries.unshift(idea.summary);
      idea = await llm.generateIdea(dna, quotePrompt.prompt_text, recentSummaries);
      hash = normalizeHash(idea.summary);
    }

    const { data: ideaRow } = await svc
      .from("content_ideas")
      .insert({ account_id: accountId, user_id: userId, idea, source_prompt_id: quotePrompt.id, normalized_hash: hash, status: "new" })
      .select("id")
      .single();

    // Stage 2 — content.
    const content = await llm.generateContent(dna, idea);
    const { data: postRow } = await svc
      .from("posts")
      .insert({
        account_id: accountId,
        user_id: userId,
        idea_id: ideaRow?.id ?? null,
        headline: content.headline,
        lines: content.lines,
        caption: content.caption,
        hashtags: content.hashtags,
        status: "generating",
        origin: "auto",
      })
      .select("id")
      .single();
    if (!postRow) throw new Error("failed to insert post");
    const postId = postRow.id;

    // bump quote prompt usage
    await svc.from("prompt_library").update({ use_count: (quotePrompt.use_count ?? 0) + 1, last_used_at: new Date().toISOString() }).eq("id", quotePrompt.id);

    // Stage 3+4 — image + quality gate (regenerate loop).
    const { data: imgPrompt } = await svc
      .from("prompt_library")
      .select("id, prompt_text, use_count")
      .eq("account_id", accountId)
      .eq("type", "image_idea")
      .eq("active", true)
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();

    const intended = { headline: content.headline, lines: content.lines };
    const imgPromptText = buildImagePrompt(dna, imgPrompt?.prompt_text ?? null, intended);
    const path = `${userId}/${accountId}/${postId}.png`;

    let passed = false;
    let attempts = 0;
    let verdict = { score: 0, reasons: [] as string[] };
    let lastBytes: Buffer | null = null;
    let lastMime = "image/png";
    while (attempts < MAX_REGEN_ATTEMPTS && !passed) {
      attempts++;
      const img = await image.generateImage(imgPromptText);
      lastBytes = img.bytes;
      lastMime = img.mimeType;
      const v = await vision.scoreImage(img, intended, dna);
      verdict = { score: v.score, reasons: v.reasons };
      await log(svc, { user_id: userId, account_id: accountId, post_id: postId, stage: "quality_gate", level: v.pass ? "info" : "warn", message: `attempt ${attempts}: ${v.pass ? "pass" : "fail"} (${v.score})`, context: { reasons: v.reasons } });
      if (v.pass) passed = true;
    }

    if (lastBytes) {
      await svc.storage.from(IMAGE_BUCKET).upload(path, lastBytes, { contentType: lastMime, upsert: true });
    }
    if (imgPrompt) {
      await svc.from("prompt_library").update({ use_count: (imgPrompt.use_count ?? 0) + 1, last_used_at: new Date().toISOString() }).eq("id", imgPrompt.id);
    }

    if (!passed) {
      await svc.from("posts").update({ image_url: lastBytes ? path : null, status: "qa_failed", qa_score: verdict.score, qa_reasons: verdict.reasons, regen_attempts: attempts }).eq("id", postId);
      await log(svc, { user_id: userId, account_id: accountId, post_id: postId, stage: "quality_gate", level: "warn", message: "QA failed after max attempts; skipped (not published)", context: { reasons: verdict.reasons } });
      return; // fail closed — never publish
    }

    await svc.from("posts").update({ image_url: path, status: "queued", qa_score: verdict.score, qa_reasons: verdict.reasons, regen_attempts: attempts }).eq("id", postId);

    // Stage 5 — publish (respect daily limit).
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await svc
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", "published")
      .gte("published_at", since);
    if ((count ?? 0) >= DAILY_LIMIT) {
      await log(svc, { user_id: userId, account_id: accountId, post_id: postId, stage: "publish", level: "warn", message: "daily limit reached; leaving queued" });
      return;
    }

    const { data: signed } = await svc.storage.from(IMAGE_BUCKET).createSignedUrl(path, 3600);
    if (!signed?.signedUrl) throw new Error("could not sign image url");
    const caption = [content.caption, content.hashtags.join(" ")].filter(Boolean).join("\n\n");
    const token = decryptSecret(account.encrypted_token as string);
    const result = await publishImagePost({ igUserId: account.ig_user_id as string, pageAccessToken: token, imageUrl: signed.signedUrl, caption });

    await svc.from("posts").update({ status: "published", ig_media_id: result.mediaId, published_at: new Date().toISOString() }).eq("id", postId);
    await log(svc, { user_id: userId, account_id: accountId, post_id: postId, stage: "publish", level: "info", message: `published ${result.mediaId}` });
  } catch (err) {
    await log(svc, { user_id: userId, account_id: accountId, stage: "pipeline", level: "error", message: err instanceof Error ? err.message : "pipeline failed" });
    throw err; // let BullMQ retry transient failures
  }
}
