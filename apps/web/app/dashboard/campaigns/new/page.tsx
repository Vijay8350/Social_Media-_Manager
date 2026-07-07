import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { InstagramAccount } from "@insta/shared";
import { CampaignWizard } from "../CampaignWizard";

export default async function NewCampaignPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instagram_accounts")
    .select("id, ig_username")
    .order("created_at", { ascending: true });

  const accounts = ((data as Pick<InstagramAccount, "id" | "ig_username">[] | null) ?? []).map(
    (a) => ({ id: a.id, handle: a.ig_username ?? "account" }),
  );

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
