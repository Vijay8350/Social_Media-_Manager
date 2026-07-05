import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe, isBillingEnabled } from "@/lib/stripe";
import { createServiceRoleClient } from "@insta/shared";

export const runtime = "nodejs";

type SubStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

function mapStatus(s: Stripe.Subscription.Status): SubStatus {
  switch (s) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "incomplete":
      return "incomplete";
    default:
      return "canceled";
  }
}

export async function POST(request: NextRequest) {
  if (!isBillingEnabled()) return NextResponse.json({ ok: true });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "no webhook secret" }, { status: 500 });

  const sig = request.headers.get("stripe-signature") ?? "";
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `signature verification failed: ${err instanceof Error ? err.message : ""}` },
      { status: 400 },
    );
  }

  const svc = createServiceRoleClient();
  const stripe = getStripe();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id ?? session.metadata?.user_id;
        const customerId = session.customer as string;
        const subId = session.subscription as string;
        if (userId && subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await svc.from("subscriptions").upsert(
            {
              user_id: userId,
              stripe_customer_id: customerId,
              stripe_subscription_id: subId,
              plan: sub.items.data[0]?.price.id ?? null,
              status: mapStatus(sub.status),
              current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const status =
          event.type === "customer.subscription.deleted"
            ? "canceled"
            : mapStatus(sub.status);
        await svc
          .from("subscriptions")
          .update({
            stripe_subscription_id: sub.id,
            plan: sub.items.data[0]?.price.id ?? null,
            status,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "handler error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
