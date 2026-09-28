import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { getDefaultAccountId, resolveDefaultAccount } from "@/lib/default-account";

export default async function DashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: accounts }, savedDefault] = await Promise.all([
    supabase
      .from("instagram_accounts")
      .select("id, ig_username, ig_user_id, status")
      .order("created_at", { ascending: true }),
    getDefaultAccountId(supabase, user.id),
  ]);
  const list = (accounts ?? []).map((a) => ({
    id: a.id as string,
    username: (a.ig_username ?? a.ig_user_id ?? "account") as string,
    status: a.status as string,
  }));
  const defaultAccount = resolveDefaultAccount(list, savedDefault);

  // Flagged comments on the default account (the Comments page opens on it).
  // Error (e.g. migration 0005 not applied yet) → count is null → no badge.
  const { count: flagged } = defaultAccount
    ? await supabase
        .from("ig_comments")
        .select("id", { count: "exact", head: true })
        .eq("account_id", defaultAccount.id)
        .eq("status", "flagged")
    : { count: 0 };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        email={user.email ?? null}
        accounts={list}
        defaultAccountId={defaultAccount?.id ?? null}
        flaggedComments={flagged ?? 0}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
