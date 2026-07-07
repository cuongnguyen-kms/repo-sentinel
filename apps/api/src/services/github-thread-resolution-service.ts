/**
 * Orchestrates resolving GitHub review threads for findings that have been
 * resolved locally. Matches PostedFindingComment.githubCommentId to thread
 * first-comment databaseId, then calls GraphQL resolveReviewThread.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { ResolveGithubThreadsResult } from "@repo-sentinel/types";
import { GheClient } from "@repo-sentinel/ghe-client";
import { decrypt } from "./encryption-service.js";

/** Loads PR connection details and creates a GheClient. */
async function loadPrClient(prisma: PrismaClient, prId: string) {
  const pr = await prisma.pullRequest.findUniqueOrThrow({
    where: { id: prId },
    select: {
      ghePrId: true,
      repo: {
        select: {
          owner: true,
          name: true,
          connection: { select: { hostname: true, token: true } },
        },
      },
    },
  });
  const token = decrypt(pr.repo.connection.token);
  const gheClient = new GheClient(pr.repo.connection.hostname, token);
  return { pr, gheClient };
}

/** Resolves reviewId fallback: returns provided value or latest completed review for the PR. */
async function resolveReviewId(
  prisma: PrismaClient,
  prId: string,
  reviewId?: string
): Promise<string | undefined> {
  if (reviewId) return reviewId;
  const latest = await prisma.aiReview.findFirst({
    where: { pullRequestId: prId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return latest?.id;
}

/** Syncs GitHub thread resolved status back to DB for threads resolved outside the app. */
export async function syncGithubThreadStatus(
  prisma: PrismaClient,
  prId: string,
  reviewId?: string
): Promise<{ synced: number }> {
  const resolvedReviewId = await resolveReviewId(prisma, prId, reviewId);
  if (!resolvedReviewId) return { synced: 0 };

  const comments = await prisma.postedFindingComment.findMany({
    where: { reviewId: resolvedReviewId, githubThreadResolved: false, githubCommentId: { not: null } },
    select: { id: true, githubCommentId: true },
  });
  if (comments.length === 0) return { synced: 0 };

  const { pr, gheClient } = await loadPrClient(prisma, prId);

  const threads = await gheClient.listReviewThreads(pr.repo.owner, pr.repo.name, pr.ghePrId);
  const resolvedByCommentId = new Map<string, boolean>();
  for (const t of threads) {
    if (t.firstCommentDatabaseId !== null) {
      resolvedByCommentId.set(String(t.firstCommentDatabaseId), t.isResolved);
    }
  }

  const toUpdate = comments
    .filter((c) => c.githubCommentId && resolvedByCommentId.get(c.githubCommentId) === true)
    .map((c) => c.id);

  if (toUpdate.length > 0) {
    await prisma.postedFindingComment.updateMany({
      where: { id: { in: toUpdate } },
      data: { githubThreadResolved: true, githubThreadResolvedAt: new Date() },
    });
  }

  return { synced: toUpdate.length };
}

/** Resolves GitHub review threads for a set of findings that have per-comment IDs. */
export async function resolveGithubThreads(
  prisma: PrismaClient,
  prId: string,
  findingIds: string[],
  reviewId?: string
): Promise<ResolveGithubThreadsResult> {
  const resolvedReviewId = await resolveReviewId(prisma, prId, reviewId);

  if (!resolvedReviewId) {
    return { resolved: 0, failed: 0, skipped: findingIds.length, errors: [] };
  }

  const postedComments = await prisma.postedFindingComment.findMany({
    where: { findingId: { in: findingIds }, reviewId: resolvedReviewId },
    select: { findingId: true, githubCommentId: true },
  });

  const commentMap = new Map(postedComments.map((c) => [c.findingId, c.githubCommentId]));

  const withCommentId: Array<{ findingId: string; githubCommentId: string }> = [];
  let skipped = 0;

  for (const fid of findingIds) {
    const ghId = commentMap.get(fid);
    if (ghId === undefined) {
      skipped++;
    } else if (ghId === null) {
      skipped++; // batch-posted finding — no per-comment ID
    } else {
      withCommentId.push({ findingId: fid, githubCommentId: ghId });
    }
  }

  if (withCommentId.length === 0) {
    return { resolved: 0, failed: 0, skipped, errors: [] };
  }

  const { pr, gheClient } = await loadPrClient(prisma, prId);

  const threads = await gheClient.listReviewThreads(pr.repo.owner, pr.repo.name, pr.ghePrId);

  const threadByCommentId = new Map<string, string>();
  for (const t of threads) {
    if (t.firstCommentDatabaseId !== null && !t.isResolved) {
      threadByCommentId.set(String(t.firstCommentDatabaseId), t.threadNodeId);
    }
  }

  let resolved = 0;
  let failed = 0;
  const errors: Array<{ findingId: string; error: string }> = [];
  const resolvedFindingIds: string[] = [];

  for (const { findingId, githubCommentId } of withCommentId) {
    const threadNodeId = threadByCommentId.get(githubCommentId);
    if (!threadNodeId) {
      skipped++;
      continue;
    }

    try {
      await gheClient.resolveReviewThread(threadNodeId);
      resolved++;
      resolvedFindingIds.push(findingId);
    } catch (err) {
      failed++;
      errors.push({ findingId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (resolvedFindingIds.length > 0) {
    await prisma.postedFindingComment.updateMany({
      where: { reviewId: resolvedReviewId, findingId: { in: resolvedFindingIds } },
      data: { githubThreadResolved: true, githubThreadResolvedAt: new Date() },
    });
  }

  return { resolved, failed, skipped, errors };
}
