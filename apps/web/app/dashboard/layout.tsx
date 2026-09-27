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

  return (
    <div className="flex min-h-screen">
      <Sidebar
        email={user.email ?? null}
        accounts={list}
        defaultAccountId={defaultAccount?.id ?? null}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
