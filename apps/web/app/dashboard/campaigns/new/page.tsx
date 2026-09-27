import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDefaultAccountId, resolveDefaultAccount } from "@/lib/default-account";
import type { InstagramAccount } from "@insta/shared";
import { CampaignWizard } from "../CampaignWizard";

export default async function NewCampaignPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data }, savedDefault] = await Promise.all([
    supabase.from("instagram_accounts").select("id, ig_username").order("created_at", { ascending: true }),
    user ? getDefaultAccountId(supabase, user.id) : Promise.resolve(null),
  ]);

  const all = ((data as Pick<InstagramAccount, "id" | "ig_username">[] | null) ?? []).map(
    (a) => ({ id: a.id, handle: a.ig_username ?? "account" }),
  );
  // Default account first so the wizard preselects it.
  const def = resolveDefaultAccount(all, savedDefault);
  const accounts = def ? [def, ...all.filter((a) => a.id !== def.id)] : all;

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <Link href="/dashboard/campaigns" className="text-sm text-muted-foreground hover:underline">
        ← Campaigns
      </Link>
      <div className="mt-3">
        {accounts.length === 0 ? (
          <div className="card border-dashed p-10 text-center text-sm text-muted-foreground">
            Connect an Instagram account first — campaigns generate for a specific account.
          </div>
        ) : (
          <CampaignWizard accounts={accounts} />
        )}
      </div>
    </main>
  );
}
