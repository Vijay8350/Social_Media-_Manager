"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { PromptType } from "@insta/shared";

async function requireUser(accountId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  // Ownership check (RLS also enforces it).
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) throw new Error("Account not found");
  return { supabase, userId: user.id };
}

export async function addPrompt(accountId: string, formData: FormData) {
  const { supabase, userId } = await requireUser(accountId);

  const type = String(formData.get("type") ?? "") as PromptType;
  const label = String(formData.get("label") ?? "").trim();
  const prompt_text = String(formData.get("prompt_text") ?? "").trim();

  if (type !== "quote_idea" && type !== "image_idea") return;
  if (!label || !prompt_text) return;

  await supabase.from("prompt_library").insert({
    account_id: accountId,
    user_id: userId,
    type,
    label,
    prompt_text,
    active: true,
  });

  revalidatePath(`/dashboard/accounts/${accountId}/prompts`);
}

export async function togglePrompt(
  accountId: string,
  promptId: string,
  active: boolean,
) {
  const { supabase } = await requireUser(accountId);
  await supabase
    .from("prompt_library")
    .update({ active })
    .eq("id", promptId);
  revalidatePath(`/dashboard/accounts/${accountId}/prompts`);
}

export async function deletePrompt(accountId: string, promptId: string) {
  const { supabase } = await requireUser(accountId);
  await supabase.from("prompt_library").delete().eq("id", promptId);
  revalidatePath(`/dashboard/accounts/${accountId}/prompts`);
}
