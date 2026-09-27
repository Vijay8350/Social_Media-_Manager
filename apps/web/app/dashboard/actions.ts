"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/** Mark one of the user's Instagram accounts as their default (stored in profiles.settings). */
export async function setDefaultAccount(accountId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) return;

  const { data: profile, error: readErr } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", user.id)
    .maybeSingle();
  // The whole settings object is written back — on a failed read, writing {} +
  // default would wipe the saved DeepSeek key, so change nothing instead.
  if (readErr) {
    console.error("[setDefaultAccount] couldn't read profile settings:", readErr.message);
    return;
  }
  const settings = {
    ...((profile?.settings as Record<string, unknown> | null) ?? {}),
    default_account_id: accountId,
  };

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, settings }, { onConflict: "id" });
  if (error) console.error("[setDefaultAccount] failed:", error.message);

  // The sidebar switcher lives in the dashboard layout — refresh everything under it.
  revalidatePath("/dashboard", "layout");
}
