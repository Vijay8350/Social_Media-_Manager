"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isMissingSchema, MIGRATION_0003_HINT, MIGRATION_0006_HINT } from "@/lib/db-errors";
import {
  assertPublicUrl,
  businessToAccountDnaPatch,
  getLLMProviderForUser,
  normalizeWebsiteUrl,
  type AccountDna,
  type BusinessDna,
  type ResearchEvent,
} from "@insta/shared";

export type BizState = { ok?: boolean; error?: string; message?: string; warnings?: string[] } | undefined;

/** A run older than this that's still "running" was interrupted (matches the worker). */
const STALE_MS = 15 * 60_000;

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
 * Start a deep-research run for the account's Business DNA. The worker does the
 * research (Instagram + a deep website crawl → evidence-backed facts → DNA
 * written from those facts → fact-check) and records progress on the row; the
 * page shows it live. The current DNA stays until the new run succeeds.
 */
export async function startBusinessResearch(
  accountId: string,
  _prev: BizState,
  formData: FormData,
): Promise<BizState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id, ig_user_id, encrypted_token")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) return { error: "Account not found" };

  // Fail fast on things the worker would only discover later.
  try {
    await getLLMProviderForUser(supabase, user.id);
  } catch (err) {
    return { error: errMsg(err, "DeepSeek isn't configured") };
  }
  const includeInstagram = formData.get("include_instagram") === "on";
  if (includeInstagram && !(account.ig_user_id && account.encrypted_token)) {
    return { error: "This account has no Instagram login stored — reconnect it, or research the website only." };
  }
  let websiteUrl: string | null = null;
  const typed = text(formData.get("website_url"));
  if (typed) {
    try {
      websiteUrl = (await assertPublicUrl(normalizeWebsiteUrl(typed))).toString();
    } catch (err) {
      return { error: `Website: ${errMsg(err, "invalid URL")}` };
    }
  }
  if (!includeInstagram && !websiteUrl) {
    return { error: "Add a website URL or include Instagram — there's nothing to research." };
  }

  const { data: current, error: readErr } = await supabase
    .from("business_dna")
    .select("research_status, research_started_at, updated_at")
    .eq("account_id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) {
    return { error: isMissingSchema(readErr) ? (/research_/.test(readErr.message) ? MIGRATION_0006_HINT : MIGRATION_0003_HINT) : readErr.message };
  }
  const since = current?.research_started_at ?? current?.updated_at;
  const running = ["queued", "researching", "analyzing"].includes(current?.research_status ?? "");
  if (running && since && Date.now() - new Date(since).getTime() < STALE_MS) {
    return { error: "Research is already running for this account." };
  }

  const now = new Date().toISOString();
  const log: ResearchEvent[] = [{ at: now, step: "Queued — waiting for the research worker" }];
  const { error } = await supabase.from("business_dna").upsert(
    {
      account_id: accountId,
      user_id: user.id,
      research_status: "queued",
      research_request: { website_url: websiteUrl, include_instagram: includeInstagram, requested_at: now },
      research_progress: log,
      research_error: null,
      research_started_at: null,
      updated_at: now,
    },
    { onConflict: "account_id" },
  );
  if (error) return { error: isMissingSchema(error) ? MIGRATION_0006_HINT : error.message };

  revalidate(accountId);
  return { ok: true, message: "Deep research started — it takes 1–3 minutes. You can leave this page." };
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
