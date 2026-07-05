"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getLLMProvider,
  getImageProvider,
  getVisionProvider,
  buildImagePrompt,
  normalizeHash,
  createServiceRoleClient,
  type AccountDna,
} from "@insta/shared";

const IMAGE_BUCKET = "post-images";
const MAX_REGEN_ATTEMPTS = Number(process.env.MAX_REGEN_ATTEMPTS) || 3;

export type GenState = { error?: string; ok?: boolean } | undefined;

export async function generateNow(
  accountId: string,
  _prev: GenState,
  formData: FormData,
): Promise<GenState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) return { error: "Account not found" };

  // Resolve the seed prompt: ad-hoc point takes precedence over a chosen prompt.
  const adhoc = String(formData.get("adhoc") ?? "").trim();
  const promptId = String(formData.get("promptId") ?? "").trim();
  let promptText = adhoc;
  let sourcePromptId: string | null = null;

  if (!promptText && promptId) {
    const { data: p } = await supabase
      .from("prompt_library")
      .select("id, prompt_text")
      .eq("id", promptId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (p) {
      promptText = p.prompt_text;
      sourcePromptId = p.id;
    }
  }
  if (!promptText) return { error: "Choose a prompt or type a point to generate from." };

  const { data: dnaRow } = await supabase
    .from("account_dna")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  const dna = (dnaRow as AccountDna | null) ?? null;

  // Recent idea summaries to steer away from repeats.
  const { data: recent } = await supabase
    .from("content_ideas")
    .select("idea")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(15);
  const recentSummaries = (recent ?? [])
    .map((r) => (r.idea as { summary?: string } | null)?.summary)
    .filter((s): s is string => Boolean(s));

  const llm = getLLMProvider();

  try {
    // Stage 1: fresh, de-duplicated idea (retry if it collides with an existing hash).
    let idea = await llm.generateIdea(dna, promptText, recentSummaries);
    let hash = normalizeHash(idea.summary);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: dup } = await supabase
        .from("content_ideas")
        .select("id")
        .eq("account_id", accountId)
        .eq("normalized_hash", hash)
        .maybeSingle();
      if (!dup) break;
      recentSummaries.unshift(idea.summary);
      idea = await llm.generateIdea(dna, promptText, recentSummaries);
      hash = normalizeHash(idea.summary);
      if (attempt === 2) return { error: "Couldn't produce a fresh idea — try again." };
    }

    const { data: ideaRow, error: ideaErr } = await supabase
      .from("content_ideas")
      .insert({
        account_id: accountId,
        user_id: user.id,
        idea,
        source_prompt_id: sourcePromptId,
        normalized_hash: hash,
        status: "new",
      })
      .select("id")
      .single();
    if (ideaErr || !ideaRow) return { error: ideaErr?.message ?? "Failed to save idea" };

    // Stage 2: content JSON.
    const content = await llm.generateContent(dna, idea);

    const { error: postErr } = await supabase.from("posts").insert({
      account_id: accountId,
      user_id: user.id,
      idea_id: ideaRow.id,
      headline: content.headline,
      lines: content.lines,
      caption: content.caption,
      hashtags: content.hashtags,
      status: "queued",
      origin: "manual",
    });
    if (postErr) return { error: postErr.message };

    // Bump prompt rotation bookkeeping.
    if (sourcePromptId) {
      const { data: cur } = await supabase
        .from("prompt_library")
        .select("use_count")
        .eq("id", sourcePromptId)
        .maybeSingle();
      await supabase
        .from("prompt_library")
        .update({
          use_count: (cur?.use_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", sourcePromptId);
    }

    revalidatePath(`/dashboard/accounts/${accountId}/content`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Generation failed" };
  }
}

/**
 * Generate the finished image for a queued post (Gemini) and store it in the
 * private post-images bucket at "{user_id}/{account_id}/{post_id}.png". Uses the
 * service role for the storage write (bucket writes bypass RLS); the DB stays on
 * the user's RLS session. Rotates an active image-idea prompt.
 */
export async function generatePostImage(accountId: string, postId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: post } = await supabase
    .from("posts")
    .select("id, account_id, headline, lines")
    .eq("id", postId)
    .eq("account_id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!post) return;

  const { data: dnaRow } = await supabase
    .from("account_dna")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();
  const dna = (dnaRow as AccountDna | null) ?? null;

  // Rotate: least-recently-used active image-idea prompt.
  const { data: imgPrompt } = await supabase
    .from("prompt_library")
    .select("id, prompt_text, use_count")
    .eq("account_id", accountId)
    .eq("type", "image_idea")
    .eq("active", true)
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  const intended = {
    headline: post.headline ?? "",
    lines: ((post.lines as string[]) ?? []),
  };
  const prompt = buildImagePrompt(dna, imgPrompt?.prompt_text ?? null, intended);

  const svc = createServiceRoleClient();
  const path = `${user.id}/${accountId}/${postId}.png`;
  const image = getImageProvider();
  const vision = getVisionProvider();

  try {
    await supabase.from("posts").update({ status: "generating" }).eq("id", postId);

    // Generate → quality-gate → regenerate loop (M4 + M5). Fail closed.
    let attempt = 0;
    let passed = false;
    let lastVerdict: { score: number; reasons: string[] } = { score: 0, reasons: [] };
    let lastBytes: Buffer | null = null;
    let lastMime = "image/png";

    while (attempt < MAX_REGEN_ATTEMPTS && !passed) {
      attempt += 1;
      const img = await image.generateImage(prompt);
      lastBytes = img.bytes;
      lastMime = img.mimeType;

      const verdict = await vision.scoreImage(img, intended, dna);
      lastVerdict = { score: verdict.score, reasons: verdict.reasons };
      await logJob(svc, {
        user_id: user.id,
        account_id: accountId,
        post_id: postId,
        stage: "quality_gate",
        level: verdict.pass ? "info" : "warn",
        message: `attempt ${attempt}: ${verdict.pass ? "pass" : "fail"} (${verdict.score})`,
        context: { reasons: verdict.reasons },
      });
      if (verdict.pass) passed = true;
    }

    // Upload the final image (passing, or the last attempt for review).
    if (lastBytes) {
      const { error: upErr } = await svc.storage
        .from(IMAGE_BUCKET)
        .upload(path, lastBytes, { contentType: lastMime, upsert: true });
      if (upErr) throw new Error(upErr.message);
    }

    await supabase
      .from("posts")
      .update({
        image_url: lastBytes ? path : null,
        status: passed ? "queued" : "qa_failed",
        qa_score: lastVerdict.score,
        qa_reasons: lastVerdict.reasons,
        regen_attempts: attempt,
      })
      .eq("id", postId);

    if (imgPrompt) {
      await supabase
        .from("prompt_library")
        .update({
          use_count: (imgPrompt.use_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", imgPrompt.id);
    }
  } catch (err) {
    await supabase.from("posts").update({ status: "queued" }).eq("id", postId);
    await logJob(svc, {
      user_id: user.id,
      account_id: accountId,
      post_id: postId,
      stage: "image_qa",
      level: "error",
      message: err instanceof Error ? err.message : "image/qa failed",
      context: {},
    });
  }

  revalidatePath(`/dashboard/accounts/${accountId}/content`);
}

/** Best-effort audit log via the service role (jobs_log writes bypass RLS). */
async function logJob(
  svc: ReturnType<typeof createServiceRoleClient>,
  entry: {
    user_id: string;
    account_id: string;
    post_id: string;
    stage: string;
    level: string;
    message: string;
    context: Record<string, unknown>;
  },
) {
  try {
    await svc.from("jobs_log").insert(entry);
  } catch {
    // never let logging break the pipeline
  }
}
