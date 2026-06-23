import { NextResponse, type NextRequest } from "next/server";
import { decryptSecret } from "@insta/shared";
import { createClient } from "@/lib/supabase/server";
import { revokeToken } from "@/lib/instagram";

export const runtime = "nodejs";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Disconnects an Instagram account: best-effort token revoke, then deletes the row. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl));

  // RLS already restricts to the owner; the explicit user_id filter is belt-and-suspenders.
  const { data: account } = await supabase
    .from("instagram_accounts")
    .select("id, ig_user_id, encrypted_token")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const dest = new URL("/dashboard", appUrl);

  if (!account) {
    dest.searchParams.set("ig_error", "not_found");
    return NextResponse.redirect(dest);
  }

  if (account.encrypted_token && account.ig_user_id) {
    try {
      const token = decryptSecret(account.encrypted_token);
      await revokeToken(account.ig_user_id, token);
    } catch {
      // Best-effort: full app-level revocation needs the user token. Deleting our
      // stored token below is the authoritative disconnect.
    }
  }

  await supabase
    .from("instagram_accounts")
    .delete()
    .eq("id", account.id)
    .eq("user_id", user.id);

  dest.searchParams.set("ig_disconnected", "1");
  return NextResponse.redirect(dest);
}
