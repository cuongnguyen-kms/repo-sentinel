/**
 * AI review orchestration service.
 *
 * Handles trigger validation, AiReview record creation (1:N via pullRequestId + commitSha),
 * BullMQ enqueueing, startup recovery, and review output parsing.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import { ReviewStatus } from "@repo-sentinel/types";
import type { Server as SocketServer } from "socket.io";
import { GheClient } from "@repo-sentinel/ghe-client";
import { getSettingInt } from "./command-template-service.js";
import { decrypt } from "./encryption-service.js";
import { resolveOutdatedFindings } from "./finding-resolution-service.js";
import { aiReviewQueue } from "../queues/ai-review-queue.js";
import { killProcess, clearOutputBuffer } from "./claude-cli-service.js";
import { ServiceError } from "../utils/service-error.js";
import { createNotification, NotificationType } from "./notification-persistence-service.js";
import { emitNotificationCreated } from "./notification-service.js";

// Minimum time between completed reviews for the same PR (anti-spam / API budget guard)
const REVIEW_COOLDOWN_MS = 5 * 60 * 1_000; // 5 minutes

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

/**
 * Validate limits, create an AiReview record (pinned to current commitSha),
 * update PR status to QUEUED, enqueue the BullMQ job, and emit a socket event.
 * Throws with a user-friendly message when limits are exceeded.
 *
 * Allows triggering when reviewStatus is UPDATED (re-review after new commits).
 */
export async function triggerReview(
  prisma: PrismaClient,
  prId: string,
  io: SocketServer,
  /** Used to log best-effort auto-resolution warnings without blocking the trigger. */
  log?: { warn: (obj: object, msg: string) => void },
  /** Skip the 5-min cooldown guard — used by auto-rerun when new commits make previous review outdated. */
  opts?: { skipCooldown?: boolean }
): Promise<{ id: string; status: string }> {
  const pr = await prisma.pullRequest.findUnique({
    where: { id: prId },
    include: { repo: { include: { connection: true } } },
  });
  if (!pr) throw new Error("Pull request not found");

  // Block if another review is already in flight
  if (pr.reviewStatus === "QUEUED" || pr.reviewStatus === "IN_PROGRESS") {
    throw new Error("A review is already in progress for this PR");
  }

  // Enforce configurable file limit (in-memory check — no DB needed)
  const maxFiles = await getSettingInt("ai.review.maxFiles", 300);
  if (pr.changedFiles > maxFiles) {
    throw new Error(
      `PR touches ${pr.changedFiles} files (limit: ${maxFiles}). Increase ai.review.maxFiles to allow larger PRs.`
    );
  }

  // Per-PR cooldown — prevent rapid re-reviews after a recent completion (anti-spam / API budget guard)
  // Skipped for auto-rerun (new commits make previous review genuinely outdated)
  if (!opts?.skipCooldown) {
    const recentCompleted = await prisma.aiReview.findFirst({
      where: { pullRequestId: prId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true },
    });
    if (recentCompleted?.completedAt) {
      const elapsed = Date.now() - recentCompleted.completedAt.getTime();
      if (elapsed < REVIEW_COOLDOWN_MS) {
        const waitSecs = Math.ceil((REVIEW_COOLDOWN_MS - elapsed) / 1_000);
        throw new ServiceError(`Review cooldown active — please wait ${waitSecs}s before re-triggering`, 429);
      }
    }
  }

  // Capture commit SHA at enqueue time — immutable on the review record.
  // If missing (legacy PRs synced before this field existed), fetch from GitHub and backfill.
  let commitSha = pr.headCommitSha;
  if (!commitSha) {
    const token = decrypt(pr.repo.connection.token);
    const gheClient = new GheClient(pr.repo.connection.hostname, token);
    const freshPr = await gheClient.getPullRequest(pr.repo.owner, pr.repo.name, pr.ghePrId);
    commitSha = freshPr.head.sha;
    if (commitSha) {
      await prisma.pullRequest.update({ where: { id: prId }, data: { headCommitSha: commitSha } });
    } else {
      throw new Error("Cannot trigger review: PR has no head commit SHA");
    }
  }

  // Best-effort: auto-resolve findings from the previous review whose lines were
  // touched by new commits. Never blocks the trigger — failures are just logged.
  try {
    const previousReview = await prisma.aiReview.findFirst({
      where: { pullRequestId: prId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: { id: true, commitSha: true },
    });
    if (previousReview && previousReview.commitSha !== "unknown" && previousReview.commitSha !== commitSha) {
      const token = decrypt(pr.repo.connection.token);
      const gheClient = new GheClient(pr.repo.connection.hostname, token);
      const comparison = await gheClient.compareCommits(pr.repo.owner, pr.repo.name, previousReview.commitSha, commitSha);
      await resolveOutdatedFindings(prisma, previousReview.id, commitSha, comparison.files);
    }
  } catch (err) {
    log?.warn({ err, prId }, "[trigger-review] auto-resolution of outdated findings failed — continuing");
  }

  // Atomically guard against concurrent triggers: re-check status + create review + update PR
  const review = await prisma.$transaction(async (tx) => {
    const freshPr = await tx.pullRequest.findUniqueOrThrow({ where: { id: prId }, select: { reviewStatus: true } });
    if (freshPr.reviewStatus === "QUEUED" || freshPr.reviewStatus === "IN_PROGRESS") {
      throw new Error("A review is already in progress for this PR");
    }

    const created = await tx.aiReview.create({
      data: { status: "QUEUED", command: "", pullRequestId: prId, commitSha },
    });
    await tx.pullRequest.update({ where: { id: prId }, data: { reviewStatus: "QUEUED" } });
    return created;
  });

  // Enqueue BullMQ job — no auto-retry (expensive Claude API calls)
  await aiReviewQueue.add(
    "ai-review",
    { reviewId: review.id, prId },
    { attempts: 1 }
  );

  io.emit("review:queued", { prId, reviewId: review.id });
  return { id: review.id, status: "QUEUED" };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancel a QUEUED or RUNNING review. Kills the CLI process (if running),
 * removes the BullMQ job (if queued), and updates DB + Socket.IO state.
 */
export async function cancelReview(
  prisma: PrismaClient,
  reviewId: string,
  io: SocketServer,
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }
): Promise<{ id: string; status: string }> {
  const review = await prisma.aiReview.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true, pullRequestId: true },
  });
  if (!review) throw new ServiceError("Review not found", 404);
  if (review.status !== "QUEUED" && review.status !== "RUNNING") {
    throw new ServiceError(`Cannot cancel review in ${review.status} state`, 409);
  }

  const roomId = `review:${reviewId}`;

  // QUEUED: remove job from BullMQ before it starts
  if (review.status === "QUEUED") {
    const jobs = await aiReviewQueue.getJobs(["waiting", "delayed", "active"]);
    for (const job of jobs) {
      if (job.data?.reviewId === reviewId) {
        await job.remove().catch(() => {});
        break;
      }
    }
  }

  // RUNNING: kill the CLI child process
  if (review.status === "RUNNING") {
    killProcess(reviewId);
  }

  // Persist CANCELLED state
  await prisma.aiReview.update({
    where: { id: reviewId },
    data: {
      status: "CANCELLED",
      errorMessage: "Cancelled by user",
      completedAt: new Date(),
      reviewPhase: "CANCELLED",
    },
  });

  // Reset PR to PENDING so user can re-trigger (PENDING = no active review)
  if (review.pullRequestId) {
    await prisma.pullRequest.update({
      where: { id: review.pullRequestId },
      data: { reviewStatus: "PENDING" },
    });
  }

  // Notify clients
  io.emit("review:cancelled", { prId: review.pullRequestId, reviewId });
  io.to(roomId).emit("review:phase", { reviewId, phase: "CANCELLED" });
  io.to(roomId).emit("review:output", "\r\n\x1b[33m[CANCELLED] Review cancelled by user.\x1b[0m\r\n");
  createNotification(prisma, {
    type: NotificationType.REVIEW_CANCELLED,
    title: "Review Cancelled",
    metadata: { prId: review.pullRequestId, reviewId },
  })
    .then(() => emitNotificationCreated(io))
    .catch(() => {});
  clearOutputBuffer(roomId);

  log?.info({ reviewId }, "review cancelled");
  return { id: reviewId, status: "CANCELLED" };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Hard-delete a completed, failed, or cancelled review.
 * Cannot delete QUEUED/RUNNING reviews — user must cancel first.
 * Cascades to PostedFindingComment via onDelete: Cascade in schema.
 * Recalculates PR reviewStatus from remaining reviews after deletion.
 */
export async function deleteReview(
  prisma: PrismaClient,
  reviewId: string,
  io: SocketServer,
  log?: { info: (obj: object, msg: string) => void }
): Promise<{ id: string }> {
  const review = await prisma.aiReview.findUnique({
    where: { id: reviewId },
    select: { id: true, status: true, pullRequestId: true },
  });
  if (!review) throw new ServiceError("Review not found", 404);

  // Cannot delete active reviews — user must cancel first
  if (review.status === "QUEUED" || review.status === "RUNNING") {
    throw new ServiceError("Cannot delete an active review. Cancel it first.", 409);
  }

  // Hard delete — PostedFindingComment cascades via onDelete: Cascade
  await prisma.aiReview.delete({ where: { id: reviewId } });

  // Recalculate PR reviewStatus from remaining reviews
  if (review.pullRequestId) {
    const latestRemaining = await prisma.aiReview.findFirst({
      where: { pullRequestId: review.pullRequestId },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });

    let newStatus: ReviewStatus;
    if (!latestRemaining) {
      newStatus = ReviewStatus.PENDING;
    } else if (latestRemaining.status === "COMPLETED") {
      newStatus = ReviewStatus.REVIEWED;
    } else if (latestRemaining.status === "FAILED") {
      newStatus = ReviewStatus.FAILED;
    } else {
      newStatus = ReviewStatus.PENDING;
    }

    await prisma.pullRequest.update({
      where: { id: review.pullRequestId },
      data: { reviewStatus: newStatus },
    });
  }

  // Notify clients
  io.emit("review:deleted", { prId: review.pullRequestId, reviewId });

  log?.info({ reviewId }, "review deleted");
  return { id: reviewId };
}

// ---------------------------------------------------------------------------
// Startup recovery
// ---------------------------------------------------------------------------

/**
 * Reset any reviews that were left in QUEUED or RUNNING state (e.g. after
 * a server restart that killed in-flight jobs) so users can re-trigger.
 *
 * Must be called AFTER the BullMQ queue has been drained (stale Redis
 * jobs cleared) and BEFORE the worker starts — otherwise BullMQ would replay
 * surviving jobs and overwrite the FAILED state we set here.
 */
export async function recoverStaleReviews(
  prisma: PrismaClient,
  log?: { warn: (msg: string) => void }
): Promise<void> {
  const stale = await prisma.aiReview.findMany({
    where: { status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true, pullRequestId: true },
  });

  if (stale.length === 0) return;

  const staleIds = stale.map((r) => r.id);
  log?.warn(
    `[startup] recovering ${staleIds.length} stale review(s): ${staleIds.join(", ")}`
  );

  await prisma.aiReview.updateMany({
    where: { id: { in: staleIds } },
    data: {
      status: "FAILED",
      errorMessage: "Server restarted while review was in progress. Please re-trigger.",
      completedAt: new Date(),
      reviewPhase: "FAILED",
    },
  });

  // Find linked PR IDs via the 1:N pullRequestId relation
  const linkedPrIds = stale
    .map((r) => r.pullRequestId)
    .filter((id): id is string => id !== null);

  if (linkedPrIds.length > 0) {
    await prisma.pullRequest.updateMany({
      where: { id: { in: linkedPrIds } },
      data: { reviewStatus: "FAILED" },
    });
  }
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/**
 * Extract a quality score and summary from the raw CLI output.
 *
 * Score: looks for "Score: X/10", "Quality: X/10", or bare "X/10" patterns.
 * Summary: prefers a "## Summary" section, falls back to the first paragraph.
 * Both fields are best-effort — raw output is always stored regardless.
 */
export function parseReviewOutput(output: string): {
  summary: string;
  score: number | null;
} {
  // Score extraction: match patterns like "Score: 7/10", "8/10", "quality: 9 / 10"
  const scoreMatch = output.match(
    /(?:score|quality|rating)[:\s]*(\d{1,2})\s*(?:\/\s*)?(?:10)/i
  ) ?? output.match(/\b(\d{1,2})\s*\/\s*10\b/);

  let score: number | null = null;
  if (scoreMatch?.[1]) {
    const parsed = parseInt(scoreMatch[1], 10);
    score = isNaN(parsed) ? null : Math.min(10, Math.max(1, parsed));
  }

  // Summary extraction: prefer "## Summary" section, fall back to first non-separator paragraph.
  const sectionMatch = output.match(
    /##\s*Summary\s*\n([\s\S]*?)(?=\n##|\n---|\s*$)/i
  );
  const rawSummary = sectionMatch
    ? sectionMatch[1]?.trim()
    : output.split(/\n\n/).find((p) => p.trim() && !/^-{3,}$/.test(p.trim()))?.trim();

  // Strip a leading "---" separator Claude sometimes inserts right after the ## Summary heading
  const cleanSummary = (rawSummary ?? "").replace(/^-{3,}\s*\n?/, "").trim();
  const summary = (cleanSummary || "Review completed").substring(0, 500);
  return { summary, score };
}
