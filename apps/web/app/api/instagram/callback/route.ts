import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { encryptSecret } from "@insta/shared";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCodeForToken,
  getLongLivedToken,
  getPagesWithInstagram,
} from "@/lib/instagram";

export const runtime = "nodejs";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function back(params: Record<string, string>) {
  const dest = new URL("/dashboard", appUrl);
  for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
  const res = NextResponse.redirect(dest);
  // Clear the one-time state cookie.
  res.cookies.set("ig_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (oauthError) return back({ ig_error: oauthError });

  const cookieStore = await cookies();
  const expectedState = cookieStore.get("ig_oauth_state")?.value;
  if (!code || !state || !expectedState || state !== expectedState) {
    return back({ ig_error: "invalid_state" });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl));

  try {
    const shortToken = await exchangeCodeForToken(code);
    const longLived = await getLongLivedToken(shortToken);
    const pages = await getPagesWithInstagram(longLived.accessToken);
    const eligible = pages.filter((p) => p.instagram !== null);

    if (pages.length === 0) {
      return back({ ig_error: "no_pages" });
    }
    if (eligible.length === 0) {
      return back({ ig_error: "no_business_account" });
    }

    const tokenExpiry = longLived.expiresAt
      ? new Date(longLived.expiresAt).toISOString()
      : null;

    let connected = 0;
    for (const page of eligible) {
      const ig = page.instagram!;
      const encrypted = encryptSecret(page.pageAccessToken);

      // Manual upsert keyed on (user_id, ig_user_id): update on reconnect, else insert.
      const { data: existing } = await supabase
        .from("instagram_accounts")
        .select("id")
        .eq("user_id", user.id)
        .eq("ig_user_id", ig.id)
        .maybeSingle();

      const row = {
        user_id: user.id,
        ig_user_id: ig.id,
        ig_username: ig.username,
        page_id: page.pageId,
        encrypted_token: encrypted,
        token_expiry: tokenExpiry,
        status: "connected" as const,
      };

      const result = existing
        ? await supabase
            .from("instagram_accounts")
            .update(row)
            .eq("id", existing.id)
        : await supabase.from("instagram_accounts").insert(row);

      if (!result.error) connected += 1;
    }

    if (connected === 0) return back({ ig_error: "save_failed" });
    return back({ ig_connected: String(connected) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "connect_failed";
    return back({ ig_error: message.slice(0, 140) });
  }
}
