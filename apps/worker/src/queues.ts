import { Queue } from "bullmq";
import { connection } from "./redis.js";

/**
 * Queue names. The pipeline queue (M3+) will carry per-account daily-run jobs
 * and on-demand "generate now" jobs. For M0 we only define the heartbeat queue
 * to prove the worker + Redis wiring end-to-end.
 */
export const QUEUE_NAMES = {
  heartbeat: "heartbeat",
  pipeline: "pipeline",
  scheduler: "scheduler",
} as const;

/**
 * BullMQ key prefix — namespaces ALL of this app's Redis keys (default is
 * "bull"). Set via BULLMQ_PREFIX so a shared Redis can host other projects
 * without key collisions. Combine with a dedicated db index in REDIS_URL
 * (e.g. redis://localhost:6379/3) for full isolation.
 */
export const QUEUE_PREFIX = process.env.BULLMQ_PREFIX ?? "insta";

export const heartbeatQueue = new Queue(QUEUE_NAMES.heartbeat, {
  connection,
  prefix: QUEUE_PREFIX,
});

export const pipelineQueue = new Queue(QUEUE_NAMES.pipeline, {
  connection,
  prefix: QUEUE_PREFIX,
});

export const schedulerQueue = new Queue(QUEUE_NAMES.scheduler, {
  connection,
  prefix: QUEUE_PREFIX,
});
