import { createServiceRoleClient } from "@insta/shared";
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

/**
 * Scan connected accounts and enqueue a daily pipeline job for any whose local
 * time has just reached its configured post time. Idempotent via a per-day jobId
 * so re-scans within the window don't double-enqueue.
 *
 * (M9 adds the subscription gate here.)
 */
export async function scanAndEnqueue(): Promise<number> {
  const svc = createServiceRoleClient();
  const { data: accounts } = await svc
    .from("instagram_accounts")
    .select("id, user_id, status")
    .eq("status", "connected");
  if (!accounts?.length) return 0;

  let enqueued = 0;
  for (const acct of accounts) {
    const { data: dna } = await svc
      .from("account_dna")
      .select("default_post_time, timezone")
      .eq("account_id", acct.id)
      .maybeSingle();
    if (!dna?.default_post_time) continue;

    const postMin = toMinutes(dna.default_post_time);
    if (postMin == null) continue;

    const { minutes, date } = localParts(dna.timezone || "UTC");
    const due = minutes >= postMin && minutes < postMin + WINDOW_MIN;
    if (!due) continue;

    await pipelineQueue.add(
      "run",
      { accountId: acct.id, userId: acct.user_id },
      {
        jobId: `daily-${acct.id}-${date}`,
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 2,
        backoff: { type: "exponential", delay: 30_000 },
      },
    );
    enqueued++;
  }
  return enqueued;
}
