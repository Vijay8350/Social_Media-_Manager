"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ScheduleState = { ok?: boolean; error?: string } | undefined;

export async function saveSchedule(
  accountId: string,
  _prev: ScheduleState,
  formData: FormData,
): Promise<ScheduleState> {
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

  const slots = formData
    .getAll("slot")
    .map((s) => String(s).trim())
    .filter((s) => /^\d{2}:\d{2}$/.test(s));
  const autonomous = formData.get("autonomous") === "on";
  const timezone = String(formData.get("timezone") ?? "UTC").trim() || "UTC";

  const fields = { posting_slots: slots, autonomous, timezone };

  // Update the schedule fields only — don't clobber the rest of the DNA.
  const { data: existing } = await supabase
    .from("account_dna")
    .select("id")
    .eq("account_id", accountId)
    .maybeSingle();

  const result = existing
    ? await supabase.from("account_dna").update(fields).eq("id", existing.id)
    : await supabase
        .from("account_dna")
        .insert({ account_id: accountId, user_id: user.id, ...fields });

  if (result.error) return { error: result.error.message };

  revalidatePath(`/dashboard/accounts/${accountId}/schedule`);
  return { ok: true };
}
