import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, isBillingEnabled } from "@/lib/stripe";

export const runtime = "nodejs";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Open the Stripe Customer Portal for the logged-in user. */
export async function POST() {
  if (!isBillingEnabled()) {
    return NextResponse.redirect(new URL("/dashboard/billing?err=disabled", appUrl));
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl));

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!sub?.stripe_customer_id) {
    return NextResponse.redirect(new URL("/dashboard/billing?err=nocustomer", appUrl));
  }

  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${appUrl}/dashboard/billing`,
  });
  return NextResponse.redirect(portal.url, { status: 303 });
}
