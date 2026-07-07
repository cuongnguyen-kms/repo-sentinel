/**
 * BullMQ repeatable scheduler that scans all active watched repos every 60 s
 * and enqueues a "poll-repo" job for each one that is due for polling.
 *
 * Queue name : "scan-repos"
 * Job name   : "scan"
 *
 * Deduplication: each "poll-repo" job uses jobId `poll-<repoId>` so BullMQ
 * will not enqueue a second job while one is still waiting/active.
 */

import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { pollingQueue } from "./repo-polling-queue.js";
import { isRepoDueForPoll } from "../services/polling-service.js";
import { makeRedisConnection } from "./redis-connection.js";

const QUEUE_NAME = "scan-repos";
const SCAN_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Initialise the scan-repos queue with a repeatable scheduler job and start
 * the worker that dispatches individual poll-repo jobs.
 *
 * Must be called after Fastify is ready so `prisma` is available.
 */
export async function startScanReposScheduler(
  fastify: FastifyInstance
): Promise<Worker> {
  const scanQueue = new Queue(QUEUE_NAME, { connection: makeRedisConnection() });

  // Upsert the repeatable scheduler — idempotent on restart
  await scanQueue.upsertJobScheduler(
    "scan-active-repos",
    { every: SCAN_INTERVAL_MS },
    { name: "scan", data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } }
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const repos = await fastify.prisma.watchedRepo.findMany({
        where: { isActive: true },
        select: {
          id: true,
          lastPolledAt: true,
          pollingInterval: true,
        },
      });

      let scheduled = 0;
      for (const repo of repos) {
        if (!isRepoDueForPoll(repo.lastPolledAt, repo.pollingInterval)) {
          continue;
        }

        // Deterministic jobId prevents duplicate jobs for the same repo within
        // a single poll cycle. removeOnComplete:{ count: 0 } ensures the hash
        // is wiped from Redis immediately so the *next* cycle can re-enqueue
        // (without it, BullMQ deduplicates against the stale completed hash).
        await pollingQueue.add(
          "poll-repo",
          { repoId: repo.id },
          {
            jobId: `poll-${repo.id}`,
            removeOnComplete: { count: 0 },
          }
        );
        scheduled++;
      }

      fastify.log.info(
        `[scan-repos] scheduled ${scheduled}/${repos.length} repos for polling`
      );
    },
    {
      connection: makeRedisConnection(),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    fastify.log.error(
      { jobId: job?.id, err: err.message },
      "[scan-repos] scan job failed"
    );
  });

  return worker;
}
