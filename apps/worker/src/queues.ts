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
} as const;

export const heartbeatQueue = new Queue(QUEUE_NAMES.heartbeat, { connection });
