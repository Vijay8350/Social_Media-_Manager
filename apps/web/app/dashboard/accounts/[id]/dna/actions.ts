"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type SaveState = { error?: string; ok?: boolean } | undefined;

/** Split a textarea into a trimmed, non-empty string array (one item per line). */
function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function csv(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function text(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim();
  return s.length ? s : null;
}

export async function saveDna(
  accountId: string,
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  // Confirm the account belongs to this user (RLS also enforces this).
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) return { error: "Account not found" };

  const row = {
    account_id: accountId,
    user_id: user.id,
    persona: text(formData.get("persona")),
    tone: text(formData.get("tone")),
    audience: text(formData.get("audience")),
    niche: text(formData.get("niche")),
    content_pillars: lines(formData.get("content_pillars")),
    visual_identity: {
      palette: csv(formData.get("palette")),
      mood: text(formData.get("mood")) ?? undefined,
      style: text(formData.get("style")) ?? undefined,
      font: text(formData.get("font")) ?? undefined,
      layout: text(formData.get("layout")) ?? undefined,
    },
    language: text(formData.get("language")) ?? "en",
    dos: lines(formData.get("dos")),
    donts: lines(formData.get("donts")),
    examples: lines(formData.get("examples")),
    default_post_time: text(formData.get("default_post_time")),
    timezone: text(formData.get("timezone")) ?? "UTC",
    hashtag_strategy: text(formData.get("hashtag_strategy")),
    updated_at: new Date().toISOString(),
  };

  // Upsert on the unique account_id.
  const { error } = await supabase
    .from("account_dna")
    .upsert(row, { onConflict: "account_id" });

  if (error) return { error: error.message };

  revalidatePath(`/dashboard/accounts/${accountId}/dna`);
  return { ok: true };
}
