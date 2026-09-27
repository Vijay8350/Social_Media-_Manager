import Link from "next/link";
import { decryptSecret, type InstagramAccount } from "@insta/shared";
import { createClient } from "@/lib/supabase/server";
import { isInstagramConfigured } from "@/lib/instagram-config";
import { inspectToken, COMMENT_SCOPE, type CheckState } from "@/lib/api-status";
import { StatusDot } from "@/components/StatusDot";

type Readiness = {
  id: string;
  username: string;
  login: { state: CheckState; label: string };
  permission: { state: CheckState; label: string };
};

async function readiness(acct: InstagramAccount): Promise<Readiness> {
  const username = acct.ig_username ?? acct.ig_user_id ?? "account";
  const unknown = { state: "off" as const, label: "Unknown" };
  if (!acct.encrypted_token || !isInstagramConfigured()) {
    return { id: acct.id, username, login: { state: "error", label: "No token" }, permission: unknown };
  }
  try {
    const t = await inspectToken(decryptSecret(acct.encrypted_token));
    return {
      id: acct.id,
      username,
      login: t.valid ? { state: "ok", label: "Valid" } : { state: "error", label: "Invalid" },
      permission: t.scopes.includes(COMMENT_SCOPE)
        ? { state: "ok", label: "Granted" }
        : { state: "error", label: "Missing" },
    };
  } catch {
    return { id: acct.id, username, login: { state: "error", label: "Check failed" }, permission: unknown };
  }
}

const PLANNED = [
  {
    title: "Auto-reply",
    points: [
      "Replies to new comments in each account's voice (Account DNA, via DeepSeek).",
      "Skips anything it isn't confident about — never guesses.",
      "Per-account on/off switch and daily reply limit.",
    ],
  },
  {
    title: "Moderation",
    points: [
      "Every comment is scored for spam, abuse, hate and scams.",
      "Bad comments are hidden and land in the review queue below.",
      "You approve, delete or restore them from here.",
    ],
  },
];

/** Comments hub (planned): auto-reply + a moderation queue for bad comments, across all accounts. */
export default async function CommentsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("instagram_accounts")
    .select("*")
    .order("created_at", { ascending: true });
  const accounts = (data ?? []) as InstagramAccount[];
  const rows = await Promise.all(accounts.map(readiness));

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Comments</h1>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-accent">
          Coming soon
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Auto-reply to comments and catch bad ones before they hurt your accounts.
      </p>

      <div className="mt-6 grid gap-3.5 sm:grid-cols-2">
        {PLANNED.map((f) => (
          <div key={f.title} className="card flex flex-col gap-2 p-5">
            <div className="flex items-center justify-between">
              <div className="font-bold">{f.title}</div>
              <StatusDot state="off" label="Planned" />
            </div>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px] text-muted-foreground">
              {f.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <section className="mt-6 flex flex-col gap-2.5">
        <h2 className="text-[15px] font-bold">Flagged comments</h2>
        <div className="card border-dashed p-8 text-center text-sm text-muted-foreground">
          No flagged comments. Once moderation is switched on, comments the AI marks as bad
          will appear here for you to review.
        </div>
      </section>

      <section className="mt-6 flex flex-col gap-2.5">
        <h2 className="text-[15px] font-bold">Account readiness</h2>
        <p className="text-[13px] text-muted-foreground">
          Reading and replying to comments needs a valid login with the{" "}
          <code className="rounded bg-muted px-1 text-xs">{COMMENT_SCOPE}</code> permission.
        </p>
        {rows.length === 0 ? (
          <div className="card border-dashed p-6 text-center text-sm text-muted-foreground">
            No Instagram accounts connected yet.
          </div>
        ) : (
          <div className="card divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-sm">
                <Link
                  href={`/dashboard/accounts/${r.id}`}
                  className="min-w-[180px] flex-1 font-semibold hover:underline"
                >
                  @{r.username}
                </Link>
                <span className="flex items-center gap-2 text-muted-foreground">
                  Login <StatusDot state={r.login.state} label={r.login.label} />
                </span>
                <span className="flex items-center gap-2 text-muted-foreground">
                  Comments permission{" "}
                  <StatusDot state={r.permission.state} label={r.permission.label} />
                </span>
              </div>
            ))}
          </div>
        )}
        {rows.some((r) => r.login.state !== "ok" || r.permission.state !== "ok") && (
          <p className="text-[13px] text-muted-foreground">
            To fix: add the Instagram product in the Meta app, include{" "}
            <code className="rounded bg-muted px-1 text-xs">{COMMENT_SCOPE}</code> in the requested
            permissions, then{" "}
            <a href="/api/instagram/connect" className="font-semibold text-accent hover:underline">
              reconnect your accounts
            </a>
            .
          </p>
        )}
      </section>
    </main>
  );
}
