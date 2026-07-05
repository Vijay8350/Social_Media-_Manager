"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLLMProvider, normalizeHash, type AccountDna } from "@insta/shared";

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
