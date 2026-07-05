import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isBillingEnabled } from "@/lib/stripe";

const ACTIVE = new Set(["active", "trialing"]);

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("status, plan, current_period_end, stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const sp = await searchParams;
  const status = sub?.status ?? "none";
  const isActive = ACTIVE.has(status);
  const billing = isBillingEnabled();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Billing</h1>

      {sp.ok && (
        <p className="mt-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          Subscription active — thanks! It may take a moment to reflect below.
        </p>
      )}
      {sp.canceled && (
        <p className="mt-4 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
          Checkout canceled.
        </p>
      )}
      {sp.err && (
        <p className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          {sp.err === "disabled"
            ? "Billing isn't configured yet."
            : `Something went wrong (${String(sp.err)}).`}
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border p-5">
        <p className="text-sm text-muted-foreground">Current plan</p>
        <p className="mt-1 text-lg font-medium">
          {isActive ? "Active" : status === "none" ? "No subscription" : status}
        </p>
        {sub?.current_period_end && (
          <p className="mt-1 text-xs text-muted-foreground">
            Renews/ends {new Date(sub.current_period_end).toLocaleDateString()}
          </p>
        )}

        {!billing ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Billing is not configured on this environment.
          </p>
        ) : (
          <div className="mt-4 flex gap-3">
            {!isActive && (
              <form action="/api/stripe/checkout" method="post">
                <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Subscribe
                </button>
              </form>
            )}
            {sub?.stripe_customer_id && (
              <form action="/api/stripe/portal" method="post">
                <button className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted">
                  Manage subscription
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        The autopilot scheduler only runs for accounts whose manager has an
        active or trialing subscription.
      </p>
    </main>
  );
}
