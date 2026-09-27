import { createServiceRoleClient, type AccountDna } from "@insta/shared";
import { pipelineQueue } from "./queues.js";

const WINDOW_MIN = 15; // scheduler tick interval

/** Local "HH:MM" and "YYYY-MM-DD" for a timezone. */
function localParts(tz: string): { minutes: number; date: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { minutes, date };
}

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

type Svc = ReturnType<typeof createServiceRoleClient>;
type Schedule = Pick<AccountDna, "default_post_time" | "timezone"> &
  Partial<Pick<AccountDna, "posting_slots" | "autonomous">>;

/**
 * Load an account's schedule settings. If migration 0002 (posting_slots /
 * autonomous) isn't applied yet, fall back to the DNA's single post time so
 * posting keeps working as it did before the Schedule tab existed.
 */
async function loadSchedule(
  svc: Svc,
  accountId: string,
  userId: string,
): Promise<{ data: Schedule | null; error: { message: string } | null }> {
  const full = await svc
    .from("account_dna")
    .select("default_post_time, timezone, posting_slots, autonomous")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (full.error?.code !== "42703") return full; // 42703 = undefined column
  return svc
    .from("account_dna")
    .select("default_post_time, timezone")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
}

/**
 * Subscription gate (M9): the users with an active/trialing subscription, or
 * null when billing isn't configured (dev / pre-billing — don't gate).
 */
export async function loadPaidUsers(svc: Svc): Promise<Set<string> | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  const { data: subs } = await svc
    .from("subscriptions")
    .select("user_id, status")
    .in("status", ["active", "trialing"]);
  return new Set((subs ?? []).map((s) => s.user_id as string));
}

// Keep finished jobs this long so their per-slot jobId keeps blocking re-adds —
// a late tick, a restart or an overlapping scan can't post the same slot twice.
const KEEP_JOBS = { age: 2 * 24 * 60 * 60 }; // seconds

/**
 * Scan connected accounts and enqueue a pipeline job for every posting slot whose
 * local time has just been reached. Slots come from the Schedule tab
 * (`posting_slots`), falling back to the DNA's single `default_post_time`.
 * Accounts with autonomous mode off are never enqueued. Idempotent via a
 * per-day, per-slot jobId so re-scans within the window don't double-enqueue.
 */
export async function scanAndEnqueue(): Promise<number> {
  const svc = createServiceRoleClient();
  const { data: accounts } = await svc
    .from("instagram_accounts")
    .select("id, user_id, status")
    .eq("status", "connected");
  if (!accounts?.length) return 0;

  const paidUsers = await loadPaidUsers(svc);

  let enqueued = 0;
  for (const acct of accounts) {
    if (paidUsers && !paidUsers.has(acct.user_id)) continue;
    const { data: dna, error: dnaErr } = await loadSchedule(svc, acct.id, acct.user_id);
    if (dnaErr) {
      console.error(`[scheduler] account=${acct.id} dna lookup failed: ${dnaErr.message}`);
      continue;
    }
    // Fail closed: autonomous mode switched off on the Schedule tab → never auto-post.
    if (!dna || dna.autonomous === false) continue;

    const configured: string[] = dna.posting_slots?.length
      ? dna.posting_slots
      : dna.default_post_time
        ? [dna.default_post_time]
        : [];
    const slotMins = [
      ...new Set(configured.map(toMinutes).filter((m): m is number => m != null)),
    ];
    if (!slotMins.length) continue;

    // A bad timezone throws a RangeError; skip this account rather than abort the whole scan.
    let local: { minutes: number; date: string };
    try {
      local = localParts(dna.timezone || "UTC");
    } catch {
      console.error(`[scheduler] account=${acct.id} invalid timezone "${dna.timezone}"; skipping`);
      continue;
    }

    for (const postMin of slotMins) {
      const due = local.minutes >= postMin && local.minutes < postMin + WINDOW_MIN;
      if (!due) continue;

      await pipelineQueue.add(
        "run",
        { accountId: acct.id, userId: acct.user_id, maxPerDay: slotMins.length },
        {
          // Minute-of-day, not "HH:MM" — BullMQ custom ids can't contain ":".
          jobId: `daily-${acct.id}-${local.date}-${postMin}`,
          removeOnComplete: KEEP_JOBS,
          removeOnFail: KEEP_JOBS,
          attempts: 2,
          backoff: { type: "exponential", delay: 30_000 },
        },
      );
      enqueued++;
    }
  }
  return enqueued;
}
