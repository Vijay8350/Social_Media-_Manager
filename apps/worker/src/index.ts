import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./redis.js";
import { QUEUE_NAMES, heartbeatQueue } from "./queues.js";

/**
 * Worker entrypoint (M0).
 *
 * Proves the BullMQ + Redis wiring: a repeatable "heartbeat" job is scheduled
 * every 60s and processed here. Later milestones replace this with the daily
 * per-account pipeline (Stages 1-6) and the scheduler that enqueues it.
 */
async function main() {
  console.log("[worker] starting…");

  const worker = new Worker(
    QUEUE_NAMES.heartbeat,
    async (job) => {
      console.log(`[worker] heartbeat ${job.id} at ${new Date().toISOString()}`);
    },
    { connection },
  );

  worker.on("ready", () => console.log("[worker] connected to Redis, ready"));
  worker.on("failed", (job, err) =>
    console.error(`[worker] job ${job?.id} failed:`, err.message),
  );

  // Schedule a repeatable heartbeat every 60s (idempotent on restart).
  await heartbeatQueue.add(
    "tick",
    {},
    {
      repeat: { every: 60_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    },
  );

  console.log("[worker] heartbeat scheduled (every 60s)");

  const shutdown = async () => {
    console.log("[worker] shutting down…");
    await worker.close();
    await heartbeatQueue.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
