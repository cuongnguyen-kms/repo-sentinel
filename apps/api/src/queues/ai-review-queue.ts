/**
 * BullMQ queue and worker for AI code review jobs.
 *
 * Queue name : "ai-review"
 * Job name   : "ai-review"
 * Job data   : { reviewId: string; prId: string }
 *
 * Worker concurrency is 1 — reviews run sequentially to avoid spawning
 * multiple Claude CLI processes simultaneously.
 */

import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { makeRedisConnection } from "./redis-connection.js";
import { runAiReviewJob, emitPhase } from "./run-ai-review-job.js";
import { clearOutputBuffer } from "../services/claude-cli-service.js";
import { createNotification, NotificationType } from "../services/notification-persistence-service.js";
import { emitNotificationCreated } from "../services/notification-service.js";

const QUEUE_NAME = "ai-review";

/** Exported queue — imported by ai-review-service to enqueue jobs. */
export const aiReviewQueue = new Queue(QUEUE_NAME, {
  connection: makeRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

/** Interval between lock renewal heartbeats during an active Claude CLI review. */
const LOCK_RENEW_INTERVAL_MS = 30_000;
/** Lock duration — short enough to detect truly stalled jobs, renewed proactively. */
const LOCK_DURATION_MS = 60_000;

/**
 * Start the BullMQ worker that processes "ai-review" jobs.
 * Must be called after Fastify is ready so prisma + io decorators are available.
 */
export function startAiReviewWorker(fastify: FastifyInstance): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    // BullMQ passes `token` as second arg — required for manual extendLock calls.
    async (job, token) => {
      const { reviewId, prId } = job.data as { reviewId: string; prId: string };

      // Claude CLI reviews can take several minutes. Renew the BullMQ lock
      // periodically so the job isn't falsely detected as stalled while active.
      const renewLock = setInterval(async () => {
        if (!token) return;
        try {
          await job.extendLock(token, LOCK_DURATION_MS);
        } catch (err) {
          fastify.log.warn({ jobId: job.id, err }, "[ai-review-worker] lock renewal failed");
        }
      }, LOCK_RENEW_INTERVAL_MS);

      try {
        await runAiReviewJob(fastify, reviewId, prId);
      } finally {
        clearInterval(renewLock);
      }
    },
    {
      connection: makeRedisConnection(),
      concurrency: 1,
      lockDuration: LOCK_DURATION_MS,
    }
  );

  // On final failure (all attempts exhausted) — persist FAILED state
  worker.on("failed", async (job, err) => {
    if (!job) return;
    const { reviewId, prId } = job.data as { reviewId: string; prId: string };
    const roomId = `review:${reviewId}`;

    // Skip if already CANCELLED — cancel endpoint handles its own state
    const current = await fastify.prisma.aiReview
      .findUnique({ where: { id: reviewId }, select: { status: true } })
      .catch(() => null);
    if (current?.status === "CANCELLED") {
      fastify.log.info({ reviewId }, "[ai-review-worker] skipping FAILED update — already CANCELLED");
      clearOutputBuffer(roomId);
      return;
    }

    fastify.log.error(
      { jobId: job.id, reviewId, prId, err: err.message },
      "[ai-review-worker] job failed"
    );

    await fastify.prisma.aiReview
      .update({
        where: { id: reviewId },
        data: {
          status: "FAILED",
          errorMessage: err.message.substring(0, 1000),
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);

    await fastify.prisma.pullRequest
      .update({ where: { id: prId }, data: { reviewStatus: "FAILED" } })
      .catch(() => undefined);

    fastify.io.emit("review:failed", { prId, reviewId, error: err.message });
    emitPhase(fastify.io, fastify.prisma, reviewId, "FAILED", fastify.log);
    createNotification(fastify.prisma, {
      type: NotificationType.REVIEW_FAILED,
      title: "Review Failed",
      message: err.message.substring(0, 200),
      metadata: { prId, reviewId, error: err.message.substring(0, 500) },
    })
      .then(() => emitNotificationCreated(fastify.io))
      .catch(() => {});
    clearOutputBuffer(roomId);
  });

  return worker;
}
