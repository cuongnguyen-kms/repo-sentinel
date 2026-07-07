/**
 * Shared BullMQ Redis connection factory.
 * Parses REDIS_URL env var into a ConnectionOptions object.
 * Used by all queues and workers in this application.
 */

import type { ConnectionOptions } from "bullmq";

export function makeRedisConnection(): ConnectionOptions {
  const raw = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const url = new URL(raw);
  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : undefined;
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.password ? { password: url.password } : {}),
    ...(db !== undefined && !isNaN(db) ? { db } : {}),
    maxRetriesPerRequest: null, // required by BullMQ
  };
}
