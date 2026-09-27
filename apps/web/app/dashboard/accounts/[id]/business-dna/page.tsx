import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getInstagramProfile } from "@/lib/instagram";
import { isMissingSchema, MIGRATION_0003_HINT } from "@/lib/db-errors";
import { decryptSecret, llmKeySource, loadLlmSettings, type BusinessDna } from "@insta/shared";
import { analyzeBusiness, applyToAccountDna, saveBusinessDna } from "./actions";
import { BusinessDnaView } from "./BusinessDnaView";

export default async function BusinessDnaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const [{ data: account }, { data: row, error }, llmSettings] = await Promise.all([
    supabase
      .from("instagram_accounts")
      .select("id, ig_user_id, ig_username, encrypted_token")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("business_dna").select("*").eq("account_id", id).maybeSingle(),
    // Display-only (the "key ready" hint); the analyze action re-reads it strictly.
    loadLlmSettings(supabase, user.id).catch(() => ({})),
  ]);
  if (!account) notFound();

  if (error && isMissingSchema(error)) {
    return <div className="card p-5 text-sm text-red-600">{MIGRATION_0003_HINT}</div>;
  }
  const business = (row as BusinessDna | null) ?? null;

  // Prefill the website from the Instagram bio link until one is saved (best-effort live read).
  let suggestedWebsite = business?.website_url ?? null;
  if (!suggestedWebsite && account.ig_user_id && account.encrypted_token) {
    try {
      const profile = await getInstagramProfile(account.ig_user_id, decryptSecret(account.encrypted_token));
      suggestedWebsite = profile.website;
    } catch {
      /* the analyze step reports Instagram problems */
    }
  }

  return (
    <BusinessDnaView
      accountId={id}
      username={account.ig_username ?? account.ig_user_id ?? "account"}
      business={business}
      suggestedWebsite={suggestedWebsite}
      llmReady={llmKeySource(llmSettings) !== "none"}
      analyzeAction={analyzeBusiness.bind(null, id)}
      saveAction={saveBusinessDna.bind(null, id)}
      applyAction={applyToAccountDna.bind(null, id)}
    />
  );
}
