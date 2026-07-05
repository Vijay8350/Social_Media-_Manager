import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, isBillingEnabled } from "@/lib/stripe";

export const runtime = "nodejs";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** Create a Stripe Checkout session for a subscription and redirect to it. */
export async function POST() {
  if (!isBillingEnabled()) {
    return NextResponse.redirect(new URL("/dashboard/billing?err=disabled", appUrl));
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", appUrl));

  const price = process.env.STRIPE_PRICE_STARTER;
  if (!price) {
    return NextResponse.redirect(new URL("/dashboard/billing?err=noprice", appUrl));
  }

  // Reuse an existing Stripe customer if we have one.
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl}/dashboard/billing?ok=1`,
    cancel_url: `${appUrl}/dashboard/billing?canceled=1`,
    client_reference_id: user.id,
    metadata: { user_id: user.id },
    ...(sub?.stripe_customer_id
      ? { customer: sub.stripe_customer_id }
      : { customer_email: user.email ?? undefined }),
  });

  if (!session.url) {
    return NextResponse.redirect(new URL("/dashboard/billing?err=session", appUrl));
  }
  return NextResponse.redirect(session.url, { status: 303 });
}
