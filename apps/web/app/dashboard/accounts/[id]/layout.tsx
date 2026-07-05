import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { InstagramAccount } from "@insta/shared";

export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!account) notFound();
  const acct = account as InstagramAccount;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            @{acct.ig_username ?? acct.ig_user_id ?? "account"}
          </h1>
        </div>
      </div>

      <nav className="mt-6 flex gap-4 border-b border-border text-sm">
        <Link
          href={`/dashboard/accounts/${id}/dna`}
          className="border-b-2 border-transparent pb-2 hover:border-muted-foreground"
        >
          Account DNA
        </Link>
        <Link
          href={`/dashboard/accounts/${id}/prompts`}
          className="border-b-2 border-transparent pb-2 hover:border-muted-foreground"
        >
          Prompt Library
        </Link>
        <Link
          href={`/dashboard/accounts/${id}/content`}
          className="border-b-2 border-transparent pb-2 hover:border-muted-foreground"
        >
          Content
        </Link>
        <Link
          href={`/dashboard/accounts/${id}/analytics`}
          className="border-b-2 border-transparent pb-2 hover:border-muted-foreground"
        >
          Analytics
        </Link>
      </nav>

      <div className="mt-8">{children}</div>
    </main>
  );
}
