import type { ConnectionOptions } from "bullmq";

/**
 * Redis connection options for BullMQ, parsed from REDIS_URL.
 *
 * We hand BullMQ an options object (not a pre-built ioredis instance) so BullMQ
 * manages its own ioredis internally — this avoids cross-version type clashes
 * with BullMQ's bundled ioredis. maxRetriesPerRequest must be null for BullMQ.
 */
function parseRedisUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port) || 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

export const connection: ConnectionOptions = parseRedisUrl(
  process.env.REDIS_URL ?? "redis://localhost:6379",
);
