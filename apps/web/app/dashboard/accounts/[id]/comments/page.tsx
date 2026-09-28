import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CommentsPanel, type CommentsAccount } from "@/app/dashboard/comments/CommentsPanel";

/** The account's Comments tab: the same panel as /dashboard/comments, for this account. */
export default async function AccountCommentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id, ig_username, ig_user_id, encrypted_token, status")
    .eq("id", id)
    .maybeSingle();
  if (!account) notFound();

  return (
    <CommentsPanel
      account={account as CommentsAccount}
      tab={sp.tab}
      baseHref={`/dashboard/accounts/${id}/comments`}
    />
  );
}
