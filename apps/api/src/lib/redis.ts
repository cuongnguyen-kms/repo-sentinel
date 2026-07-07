/**
 * Shared Redis client instance.
 * Import this instead of creating new Redis() in each module.
 */
import { Redis } from "ioredis";

export const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:6379");

redis.on("error", (err) => {
  console.error("[redis] connection error:", err);
});
