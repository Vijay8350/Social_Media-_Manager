import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./redis.js";
import {
  QUEUE_NAMES,
  QUEUE_PREFIX,
  schedulerQueue,
  analyticsQueue,
  commentsQueue,
  researchQueue,
} from "./queues.js";
import { runDailyPipeline } from "./pipeline.js";
import { scanAndEnqueue } from "./scheduler.js";
import { pullAnalytics } from "./analytics.js";
import { sweepComments } from "./comments.js";
import { processResearchQueue } from "./research.js";

/**
 * Worker entrypoint (M7 autopilot).
 *
 * - scheduler queue: a repeatable tick (every 15 min) scans accounts and
 *   enqueues due daily pipeline jobs (idempotent per day).
 * - pipeline queue: runs the full Stage 1–5 chain for one account, with
 *   BullMQ retries/backoff on transient failures.
 */
async function main() {
  console.log("[worker] starting…");

  const schedulerWorker = new Worker(
    QUEUE_NAMES.scheduler,
    async () => {
      const n = await scanAndEnqueue();
      if (n > 0) console.log(`[scheduler] enqueued ${n} account(s)`);
    },
    { connection, prefix: QUEUE_PREFIX },
  );

  const pipelineWorker = new Worker(
    QUEUE_NAMES.pipeline,
    async (job) => {
      const { accountId, userId, maxPerDay } = job.data as {
        accountId: string;
        userId: string;
        maxPerDay?: number;
      };
      console.log(`[pipeline] run account=${accountId}`);
      await runDailyPipeline(accountId, userId, maxPerDay);
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 2 },
  );

  const commentsWorker = new Worker(
    QUEUE_NAMES.comments,
    async () => {
      const n = await sweepComments();
      if (n > 0) console.log(`[comments] reviewed ${n} comment(s)`);
    },
    { connection, prefix: QUEUE_PREFIX },
  );

  // Business DNA deep research: one queued run at a time (takes 1–3 minutes).
  const researchWorker = new Worker(
    QUEUE_NAMES.research,
    async () => {
      const n = await processResearchQueue();
      if (n > 0) console.log("[research] finished a Business DNA research run");
    },
    { connection, prefix: QUEUE_PREFIX },
  );

  const analyticsWorker = new Worker(
    QUEUE_NAMES.analytics,
    async () => {
      const n = await pullAnalytics();
      if (n > 0) console.log(`[analytics] updated ${n} post metric(s)`);
    },
    { connection, prefix: QUEUE_PREFIX },
  );

  schedulerWorker.on("ready", () => console.log("[worker] connected to Redis, ready"));
  pipelineWorker.on("failed", (job, err) =>
    console.error(`[pipeline] job ${job?.id} failed:`, err.message),
  );

  // Repeatable scheduler tick every 15 minutes (idempotent id).
  await schedulerQueue.add(
    "tick",
    {},
    { repeat: { every: 15 * 60_000 }, removeOnComplete: true, removeOnFail: 50 },
  );
  // Analytics pull every 6 hours.
  await analyticsQueue.add(
    "pull",
    {},
    { repeat: { every: 6 * 60 * 60_000 }, removeOnComplete: true, removeOnFail: 50 },
  );
  // Comments sweep every 15 minutes (auto-reply + moderation).
  await commentsQueue.add(
    "sweep",
    {},
    { repeat: { every: 15 * 60_000 }, removeOnComplete: true, removeOnFail: 50 },
  );
  // Poll for queued Business DNA research every 15 seconds.
  await researchQueue.add(
    "poll",
    {},
    { repeat: { every: 15_000 }, removeOnComplete: true, removeOnFail: 50 },
  );
  console.log("[worker] scheduler (15m) + comments (15m) + research poll (15s) + analytics (6h) scheduled");

  const shutdown = async () => {
    console.log("[worker] shutting down…");
    await schedulerWorker.close();
    await pipelineWorker.close();
    await analyticsWorker.close();
    await commentsWorker.close();
    await researchWorker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
