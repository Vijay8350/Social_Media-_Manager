import { createClient } from "@/lib/supabase/server";
import type { Post, PostMetric } from "@insta/shared";

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: postRows } = await supabase
    .from("posts")
    .select("*")
    .eq("account_id", id)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(50);
  const posts = (postRows as Post[] | null) ?? [];

  // Latest metric snapshot per post.
  const latest = new Map<string, PostMetric>();
  if (posts.length) {
    const { data: metricRows } = await supabase
      .from("post_metrics")
      .select("*")
      .in(
        "post_id",
        posts.map((p) => p.id),
      )
      .order("fetched_at", { ascending: false });
    for (const m of (metricRows as PostMetric[] | null) ?? []) {
      if (!latest.has(m.post_id)) latest.set(m.post_id, m);
    }
  }

  const sum = (key: keyof PostMetric) =>
    [...latest.values()].reduce((a, m) => a + (Number(m[key]) || 0), 0);

  const totals = {
    published: posts.length,
    likes: sum("likes"),
    reach: sum("reach"),
    saves: sum("saves"),
    comments: sum("comments"),
  };
  const maxLikes = Math.max(1, ...[...latest.values()].map((m) => m.likes ?? 0));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Published" value={totals.published} />
        <Stat label="Likes" value={totals.likes} />
        <Stat label="Reach" value={totals.reach} />
        <Stat label="Saves" value={totals.saves} />
        <Stat label="Comments" value={totals.comments} />
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No published posts yet. Metrics appear here after posts go live (the
          worker refreshes insights every few hours).
        </p>
      ) : (
        <section>
          <h2 className="text-sm font-semibold text-foreground">Top posts</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {[...posts]
              .sort(
                (a, b) =>
                  (latest.get(b.id)?.likes ?? 0) - (latest.get(a.id)?.likes ?? 0),
              )
              .map((post) => {
                const m = latest.get(post.id);
                const likes = m?.likes ?? 0;
                return (
                  <li key={post.id} className="rounded-lg border border-border p-3">
                    <p className="truncate text-sm font-medium">{post.headline}</p>
                    <div className="mt-1 h-2 w-full rounded bg-muted">
                      <div
                        className="h-2 rounded bg-primary"
                        style={{ width: `${Math.round((likes / maxLikes) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {m
                        ? `♥ ${m.likes ?? 0} · reach ${m.reach ?? "—"} · saves ${m.saves ?? "—"} · comments ${m.comments ?? 0}`
                        : "no metrics yet"}
                    </p>
                  </li>
                );
              })}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}
