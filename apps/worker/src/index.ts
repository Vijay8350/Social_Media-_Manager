import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./redis.js";
import { QUEUE_NAMES, QUEUE_PREFIX, schedulerQueue } from "./queues.js";
import { runDailyPipeline } from "./pipeline.js";
import { scanAndEnqueue } from "./scheduler.js";

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
      const { accountId, userId } = job.data as { accountId: string; userId: string };
      console.log(`[pipeline] run account=${accountId}`);
      await runDailyPipeline(accountId, userId);
    },
    { connection, prefix: QUEUE_PREFIX, concurrency: 2 },
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
  console.log("[worker] scheduler tick scheduled (every 15m)");

  const shutdown = async () => {
    console.log("[worker] shutting down…");
    await schedulerWorker.close();
    await pipelineWorker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
