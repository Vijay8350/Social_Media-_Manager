"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getInstagramProfile, getRecentMedia } from "@/lib/instagram";
import { isMissingSchema, MIGRATION_0003_HINT } from "@/lib/db-errors";
import {
  buildBusinessSourceText,
  businessToAccountDnaPatch,
  crawlWebsite,
  decryptSecret,
  getLLMProviderForUser,
  normalizeWebsiteUrl,
  type AccountDna,
  type BusinessDna,
  type BusinessDnaSources,
  type BusinessSourceInput,
  type WebsiteSnapshot,
} from "@insta/shared";

export type BizState = { ok?: boolean; error?: string; message?: string; warnings?: string[] } | undefined;

const CAPTIONS_TO_READ = 30;

const errMsg = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function text(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

function revalidate(accountId: string) {
  revalidatePath(`/dashboard/accounts/${accountId}/business-dna`);
  revalidatePath(`/dashboard/accounts/${accountId}/dna`);
}

/**
 * Build (or rebuild) the account's Business DNA: read the Instagram profile +
 * recent captions and the website, then have DeepSeek distill them. Either
 * source may fail on its own — we analyze whatever we could read.
 */
export async function analyzeBusiness(
  accountId: string,
  _prev: BizState,
  formData: FormData,
): Promise<BizState> {
  // Finish (with an error if need be) before nginx's 180 s proxy_read_timeout turns it into a 504.
  const deadline = Date.now() + 150_000;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id, ig_user_id, ig_username, encrypted_token")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) return { error: "Account not found" };

  let llm: Awaited<ReturnType<typeof getLLMProviderForUser>>;
  try {
    llm = await getLLMProviderForUser(supabase, user.id);
  } catch (err) {
    return { error: errMsg(err, "DeepSeek isn't configured") };
  }

  const warnings: string[] = [];
  const sources: BusinessDnaSources = {};

  // 1) Instagram — profile + recent captions via the Graph API.
  let instagram: BusinessSourceInput["instagram"] = null;
  if (formData.get("include_instagram") === "on") {
    if (account.ig_user_id && account.encrypted_token) {
      try {
        const token = decryptSecret(account.encrypted_token);
        const [profile, media] = await Promise.all([
          getInstagramProfile(account.ig_user_id, token),
          getRecentMedia(account.ig_user_id, token, CAPTIONS_TO_READ).catch(() => []),
        ]);
        instagram = { ...profile, posts: media };
        sources.instagram = {
          username: profile.username,
          posts_analyzed: media.filter((m) => m.caption).length,
          followers: profile.followers,
        };
      } catch (err) {
        const msg = errMsg(err, "request failed");
        warnings.push(`Instagram: ${msg}`);
        sources.instagram = { username: account.ig_username, posts_analyzed: 0, followers: null, error: msg };
      }
    } else {
      warnings.push("Instagram: no stored token for this account — reconnect it to include Instagram.");
    }
  }

  // 2) Website — the URL typed in, else the link in the Instagram bio.
  const websiteInput = text(formData.get("website_url")) ?? instagram?.website ?? null;
  let website: WebsiteSnapshot | null = null;
  if (websiteInput) {
    try {
      website = await crawlWebsite(normalizeWebsiteUrl(websiteInput));
      sources.website = { url: website.url, pages: website.pages.map((p) => p.url) };
      const chars = website.pages.reduce((n, p) => n + p.text.length, 0);
      if (chars < 300) {
        warnings.push(
          "Website: very little readable text (it may be built with JavaScript), so the result leans on Instagram.",
        );
      }
    } catch (err) {
      const msg = errMsg(err, "couldn't load the site");
      warnings.push(`Website: ${msg}`);
      sources.website = { url: normalizeWebsiteUrl(websiteInput), pages: [], error: msg };
    }
  }

  if (!instagram && !website) {
    return {
      error: "Nothing to analyze — add a website URL or include Instagram.",
      warnings,
    };
  }

  // 3) DeepSeek distills the sources into a Business DNA.
  let dna;
  try {
    dna = await llm.analyzeBusiness(buildBusinessSourceText({ instagram, website }), { deadline });
  } catch (err) {
    return { error: `DeepSeek analysis failed: ${errMsg(err, "unknown error")}`, warnings };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("business_dna").upsert(
    {
      account_id: accountId,
      user_id: user.id,
      ...dna,
      website_url: website?.url ?? sources.website?.url ?? null,
      sources,
      generated_at: now,
      updated_at: now,
    },
    { onConflict: "account_id" },
  );
  if (error) return { error: isMissingSchema(error) ? MIGRATION_0003_HINT : error.message, warnings };

  const used = [
    instagram && `@${instagram.username} (${sources.instagram?.posts_analyzed ?? 0} captions)`,
    website && `${new URL(website.url).hostname} (${website.pages.length} page${website.pages.length === 1 ? "" : "s"})`,
  ].filter(Boolean);
  revalidate(accountId);
  return { ok: true, message: `Business DNA built from ${used.join(" + ")}.`, warnings };
}

/** Save manual edits to the Business DNA. */
export async function saveBusinessDna(
  accountId: string,
  _prev: BizState,
  formData: FormData,
): Promise<BizState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const website = text(formData.get("website_url"));
  const { error } = await supabase
    .from("business_dna")
    .update({
      business_name: text(formData.get("business_name")),
      website_url: website ? normalizeWebsiteUrl(website) : null,
      summary: text(formData.get("summary")),
      industry: text(formData.get("industry")),
      offerings: lines(formData.get("offerings")),
      usps: lines(formData.get("usps")),
      target_customers: text(formData.get("target_customers")),
      brand_voice: text(formData.get("brand_voice")),
      tone: text(formData.get("tone")),
      brand_values: lines(formData.get("brand_values")),
      key_messages: lines(formData.get("key_messages")),
      content_themes: lines(formData.get("content_themes")),
      ctas: lines(formData.get("ctas")),
      keywords: lines(formData.get("keywords")),
      visual_cues: text(formData.get("visual_cues")),
      language: text(formData.get("language")),
      dos: lines(formData.get("dos")),
      donts: lines(formData.get("donts")),
      use_in_generation: formData.get("use_in_generation") === "on",
      updated_at: new Date().toISOString(),
    })
    .eq("account_id", accountId)
    .eq("user_id", user.id);
  if (error) return { error: isMissingSchema(error) ? MIGRATION_0003_HINT : error.message };

  revalidate(accountId);
  return { ok: true, message: "Saved ✓" };
}

/** Copy the Business DNA onto the account's Account DNA (voice, audience, pillars, rules…). */
export async function applyToAccountDna(
  accountId: string,
  _prev: BizState,
  _formData: FormData,
): Promise<BizState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const [{ data: bizRow, error: bizErr }, { data: dnaRow }] = await Promise.all([
    supabase.from("business_dna").select("*").eq("account_id", accountId).eq("user_id", user.id).maybeSingle(),
    supabase.from("account_dna").select("*").eq("account_id", accountId).eq("user_id", user.id).maybeSingle(),
  ]);
  if (bizErr) return { error: isMissingSchema(bizErr) ? MIGRATION_0003_HINT : bizErr.message };
  if (!bizRow) return { error: "Build the Business DNA first." };

  const { patch, fields } = businessToAccountDnaPatch(bizRow as BusinessDna, dnaRow as AccountDna | null);
  if (!fields.length) return { error: "The Business DNA has nothing to apply yet." };

  const { error } = await supabase
    .from("account_dna")
    .upsert(
      { account_id: accountId, user_id: user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "account_id" },
    );
  if (error) return { error: error.message };

  revalidate(accountId);
  return { ok: true, message: `Applied to Account DNA: ${fields.join(", ")}.` };
}
