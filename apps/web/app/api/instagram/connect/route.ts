import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { getOAuthDialogUrl } from "@/lib/instagram";

export const runtime = "nodejs";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Kicks off Facebook Login: sets a CSRF state cookie and redirects to the OAuth dialog. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", appUrl));
  }

  let dialogUrl: string;
  const state = randomUUID();
  try {
    dialogUrl = getOAuthDialogUrl(state);
  } catch {
    const dest = new URL("/dashboard", appUrl);
    dest.searchParams.set("ig_error", "not_configured");
    return NextResponse.redirect(dest);
  }

  const res = NextResponse.redirect(dialogUrl);
  res.cookies.set("ig_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
