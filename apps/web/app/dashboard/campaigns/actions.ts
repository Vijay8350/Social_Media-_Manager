"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLLMProvider, normalizeHash, type AccountDna } from "@insta/shared";

function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

/** Compile the campaign brief into a single prompt used to seed generation. */
function compileCampaignPrompt(c: {
  name: string;
  handle: string;
  topic: string;
  goal: string;
  tone: string;
  perDay: string;
  days: string;
  hasRefs: boolean;
}): string {
  return `Campaign "${c.name || "Untitled"}" for @${c.handle} — theme: ${
    c.topic || "account DNA pillars"
  }. Goal: ${c.goal.toLowerCase()}. Tone: ${c.tone.toLowerCase()}. Cadence: ${
    c.perDay
  } post(s) per day for ${c.days}, at the account's scheduled slots.${
    c.hasRefs
      ? " Visual direction: follow the campaign reference images for palette, texture and composition, blended with the account's visual identity."
      : ""
  } Every idea must be de-duplicated against past posts; every image must pass the quality gate (text fidelity, legibility, on-DNA, safety) before publishing — skip, never force.`;
}

export async function createCampaign(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const accountId = str(formData.get("accountId"));
  const name = str(formData.get("name")) || "Untitled campaign";
  const topic = str(formData.get("topic"));
  const goal = str(formData.get("goal")) || "Engagement & saves";
  const tone = str(formData.get("tone")) || "Calm & wise";
  const perDay = str(formData.get("perDay")) || "1";
  const days = str(formData.get("days")) || "7 days";
  const refs = str(formData.get("refs"))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id, ig_username")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) redirect("/dashboard/campaigns?err=account");

  const daysNum = parseInt(days, 10) || 7;
  const perDayNum = parseInt(perDay, 10) || 1;
  const prompt = compileCampaignPrompt({
    name,
    handle: account.ig_username ?? "account",
    topic,
    goal,
    tone,
    perDay,
    days,
    hasRefs: refs.length > 0,
  });

  await supabase.from("campaigns").insert({
    account_id: accountId,
    user_id: user.id,
    name,
    topic: topic || null,
    goal,
    tone,
    per_day: perDayNum,
    days: daysNum,
    prompt,
    reference_images: refs,
    status: "active",
    posts_target: perDayNum * daysNum,
    posts_done: 0,
  });

  revalidatePath("/dashboard/campaigns");
  redirect("/dashboard/campaigns");
}

export async function setCampaignStatus(id: string, status: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("campaigns")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id);
  revalidatePath("/dashboard/campaigns");
}

/** Generate one post from a campaign's prompt (text stage), queue it, bump progress. */
export async function generateFromCampaign(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!campaign) return;

  const { data: dnaRow } = await supabase
    .from("account_dna")
    .select("*")
    .eq("account_id", campaign.account_id)
    .maybeSingle();
  const dna = (dnaRow as AccountDna | null) ?? null;

  const { data: recent } = await supabase
    .from("content_ideas")
    .select("idea")
    .eq("account_id", campaign.account_id)
    .order("created_at", { ascending: false })
    .limit(15);
  const recentSummaries = (recent ?? [])
    .map((r) => (r.idea as { summary?: string } | null)?.summary)
    .filter((s): s is string => Boolean(s));

  const seed = campaign.prompt || campaign.topic || campaign.name;
  const llm = getLLMProvider();

  try {
    let idea = await llm.generateIdea(dna, seed, recentSummaries);
    let hash = normalizeHash(idea.summary);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: dup } = await supabase
        .from("content_ideas")
        .select("id")
        .eq("account_id", campaign.account_id)
        .eq("normalized_hash", hash)
        .maybeSingle();
      if (!dup) break;
      recentSummaries.unshift(idea.summary);
      idea = await llm.generateIdea(dna, seed, recentSummaries);
      hash = normalizeHash(idea.summary);
      if (attempt === 2) return;
    }

    const { data: ideaRow } = await supabase
      .from("content_ideas")
      .insert({
        account_id: campaign.account_id,
        user_id: user.id,
        idea,
        normalized_hash: hash,
        status: "new",
      })
      .select("id")
      .single();

    const content = await llm.generateContent(dna, idea);
    await supabase.from("posts").insert({
      account_id: campaign.account_id,
      user_id: user.id,
      idea_id: ideaRow?.id ?? null,
      campaign_id: campaign.id,
      headline: content.headline,
      lines: content.lines,
      caption: content.caption,
      hashtags: content.hashtags,
      status: "queued",
      origin: "manual",
    });

    await supabase
      .from("campaigns")
      .update({ posts_done: (campaign.posts_done ?? 0) + 1 })
      .eq("id", campaign.id);
  } catch (err) {
    console.error("[generateFromCampaign] failed:", err);
  }

  revalidatePath("/dashboard/campaigns");
}
