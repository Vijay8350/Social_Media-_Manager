import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The user's saved default Instagram account id (`profiles.settings.default_account_id`). */
export async function getDefaultAccountId(
  supabase: Supabase,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("settings")
    .eq("id", userId)
    .maybeSingle();
  const id = (data?.settings as { default_account_id?: unknown } | null)?.default_account_id;
  return typeof id === "string" ? id : null;
}

/** The effective default: the saved account if it still exists, else the first one. */
export function resolveDefaultAccount<T extends { id: string }>(
  accounts: T[],
  savedId: string | null,
): T | null {
  return accounts.find((a) => a.id === savedId) ?? accounts[0] ?? null;
}
