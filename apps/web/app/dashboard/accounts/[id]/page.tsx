import { notFound } from "next/navigation";
import type { InstagramAccount } from "@insta/shared";
import { createClient } from "@/lib/supabase/server";
import { getDefaultAccountId, resolveDefaultAccount } from "@/lib/default-account";
import { AccountDetails } from "@/components/AccountDetails";

/** Account overview: live Instagram profile + recent posts, connection info, default toggle. */
export default async function AccountOverviewPage({
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

  const [{ data: accounts }, savedDefault] = await Promise.all([
    supabase.from("instagram_accounts").select("*").order("created_at", { ascending: true }),
    getDefaultAccountId(supabase, user.id),
  ]);
  const list = (accounts ?? []) as InstagramAccount[];
  const acct = list.find((a) => a.id === id);
  if (!acct) notFound();

  return (
    <AccountDetails
      account={acct}
      isDefault={resolveDefaultAccount(list, savedDefault)?.id === acct.id}
      userId={user.id}
    />
  );
}
