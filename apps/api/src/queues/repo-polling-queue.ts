/**
 * BullMQ queue and worker for per-repository PR polling.
 *
 * Queue name : "repo-polling"
 * Job name   : "poll-repo"
 * Job data   : { repoId: string }
 *
 * Worker processes up to 10 jobs in parallel with exponential-backoff retries.
 * The Fastify instance is passed in so the worker can access prisma + io.
 */

import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { pollRepo } from "../services/polling-service.js";
import { makeRedisConnection } from "./redis-connection.js";

const QUEUE_NAME = "repo-polling";

export const pollingQueue = new Queue(QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

/**
 * Start the BullMQ worker that processes "poll-repo" jobs.
 * Must be called after Fastify is ready so prisma + io decorators are available.
 */
export function startPollingWorker(fastify: FastifyInstance): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { repoId } = job.data as { repoId: string };
      await pollRepo(fastify.prisma, repoId, fastify.io);
    },
    {
      connection: makeRedisConnection(),
      concurrency: 10,
    }
  );

  worker.on("failed", (job, err) => {
    fastify.log.error(
      { jobId: job?.id, repoId: job?.data?.repoId, err: err.message },
      "[polling-worker] job failed"
    );
  });

  return worker;
}
