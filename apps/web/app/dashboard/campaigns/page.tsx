import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Campaign } from "@insta/shared";
import { generateFromCampaign, setCampaignStatus } from "./actions";

type Row = Campaign & { instagram_accounts: { ig_username: string | null } | null };

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-500/10 text-green-700 dark:text-green-400",
  draft: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  paused: "bg-muted text-muted-foreground",
  done: "bg-muted text-muted-foreground",
};

export default async function CampaignsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("campaigns")
    .select("*, instagram_accounts(ig_username)")
    .order("created_at", { ascending: false });
  const campaigns = (data as Row[] | null) ?? [];

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Themed runs of posts with their own prompt and cadence.
          </p>
        </div>
        <Link href="/dashboard/campaigns/new" className="btn-primary">＋ New campaign</Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="card mt-6 border-dashed p-10 text-center text-sm text-muted-foreground">
          No campaigns yet. Create one to run a themed batch of posts through the pipeline.
        </div>
      ) : (
        <div className="mt-6 grid gap-3.5 sm:grid-cols-2">
          {campaigns.map((c) => {
            const pct = c.posts_target
              ? Math.min(100, Math.round((c.posts_done / c.posts_target) * 100))
              : 0;
            return (
              <div key={c.id} className="card flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <div className="font-bold">{c.name}</div>
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_BADGE[c.status] ?? "bg-muted text-muted-foreground"}`}>
                    {c.status}
                  </span>
                </div>
                <div className="text-[13.5px] text-muted-foreground">
                  @{c.instagram_accounts?.ig_username ?? "account"} · {c.topic ?? "account DNA pillars"}
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{c.per_day} posts/day</span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{c.days} days</span>
                  {c.reference_images?.length > 0 && (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">{c.reference_images.length} refs</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[12.5px] text-muted-foreground">
                    <span>{c.posts_done} / {c.posts_target} posts</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="mt-1 flex gap-2 border-t border-border pt-3">
                  <form action={generateFromCampaign.bind(null, c.id)}>
                    <button className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-muted">
                      ✦ Generate one
                    </button>
                  </form>
                  <form action={setCampaignStatus.bind(null, c.id, c.status === "active" ? "paused" : "active")}>
                    <button className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold hover:bg-muted">
                      {c.status === "active" ? "Pause" : "Activate"}
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
