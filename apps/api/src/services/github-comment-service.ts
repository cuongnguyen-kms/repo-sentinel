/**
 * Orchestrates posting AI review findings as GitHub PR comments.
 * Loads PR + connection, constructs GheClient, delegates to GheClient methods.
 * Persists posted comments to DB so the frontend can verify if they still exist.
 *
 * Commit SHA is resolved from AiReview.commitSha (pinned at enqueue time) rather
 * than PullRequest.headCommitSha — ensures comments reference the correct commit.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { PostedFindingCommentDto, ResolutionReason, ResolutionStatus } from "@repo-sentinel/types";
import { GheClient } from "@repo-sentinel/ghe-client";
import { decrypt } from "./encryption-service.js";
import type { PostCommentBody, SubmitReviewBody } from "../schemas/review-schemas.js";
import { ServiceError } from "../utils/service-error.js";

/** Resolve reviewId: use supplied value, or fall back to the latest completed review for prId. */
async function resolveReviewId(prisma: PrismaClient, prId: string, reviewId?: string): Promise<string> {
  if (reviewId) return reviewId;
  const latest = await prisma.aiReview.findFirst({
    where: { pullRequestId: prId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) throw new ServiceError("No review found for this PR", 404);
  return latest.id;
}

/** Translate raw GitHub API errors into user-friendly messages. */
function toUserFriendlyError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/line could not be resolved/i.test(msg) || /path could not be resolved/i.test(msg)) {
    return new Error(
      "Some findings reference lines or files outside the PR diff. " +
      "GitHub cannot attach comments there — please post them individually or re-run the AI review."
    );
  }
  if (/pull_request_review_thread\.line.*could not be resolved/i.test(msg)) {
    return new Error(
      "This finding references a line not present in the PR diff. " +
      "GitHub cannot attach an inline comment there."
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

interface PrWithConnection {
  ghePrId: number;
  headCommitSha: string | null;
  repo: {
    owner: string;
    name: string;
    connection: { hostname: string; token: string };
  };
}

async function loadPrWithConnection(
  prisma: PrismaClient,
  prId: string
): Promise<PrWithConnection> {
  return prisma.pullRequest.findUniqueOrThrow({
    where: { id: prId },
    select: {
      ghePrId: true,
      headCommitSha: true,
      repo: {
        select: {
          owner: true,
          name: true,
          connection: { select: { hostname: true, token: true } },
        },
      },
    },
  });
}

function buildClient(pr: PrWithConnection): {
  client: GheClient;
  owner: string;
  repo: string;
} {
  const token = decrypt(pr.repo.connection.token);
  return {
    client: new GheClient(pr.repo.connection.hostname, token),
    owner: pr.repo.owner,
    repo: pr.repo.name,
  };
}

/**
 * Resolve the commit SHA to use for GitHub review comments.
 * If a specific reviewId is provided, uses that review's commitSha.
 * Otherwise falls back to the latest completed AiReview.
 * Falls back to PR.headCommitSha for legacy reviews (commitSha = 'unknown').
 * Last resort: fetches live from GitHub.
 */
async function resolveReviewCommitSha(
  prisma: PrismaClient,
  prId: string,
  pr: PrWithConnection,
  client: GheClient,
  owner: string,
  repo: string,
  specificReviewId?: string
): Promise<{ commitSha: string; reviewId: string }> {
  const review = specificReviewId
    ? await prisma.aiReview.findFirst({
        where: { id: specificReviewId, pullRequestId: prId },
        select: { id: true, commitSha: true },
      })
    : await prisma.aiReview.findFirst({
        where: { pullRequestId: prId, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { id: true, commitSha: true },
      });

  if (review && review.commitSha !== "unknown") {
    return { commitSha: review.commitSha, reviewId: review.id };
  }

  if (pr.headCommitSha) {
    return { commitSha: pr.headCommitSha, reviewId: review?.id ?? "" };
  }

  const livePr = await client.getPullRequest(owner, repo, pr.ghePrId);
  const sha = livePr.head?.sha;
  if (!sha) {
    throw new ServiceError(`Unable to resolve commit SHA for PR #${pr.ghePrId}`, 500);
  }
  await prisma.pullRequest.update({ where: { id: prId }, data: { headCommitSha: sha } });
  return { commitSha: sha, reviewId: review?.id ?? "" };
}

/**
 * Persist a posted finding comment to DB.
 * Uses upsert so re-posting after deletion cleanly resets the record.
 */
async function persistPostedComment(
  prisma: PrismaClient,
  reviewId: string,
  findingId: string,
  githubCommentId: number | null,
  githubHtmlUrl: string
): Promise<void> {
  // Store as string — GitHub comment IDs exceed INT4 max (2^31-1)
  const commentIdStr = githubCommentId !== null ? String(githubCommentId) : null;
  await prisma.postedFindingComment.upsert({
    where: { reviewId_findingId: { reviewId, findingId } },
    create: { reviewId, findingId, githubCommentId: commentIdStr, githubHtmlUrl },
    update: {
      githubCommentId: commentIdStr,
      githubHtmlUrl,
      deletedOnGithub: false,
      postedAt: new Date(),
    },
  });
}

/**
 * Post a single finding as an inline PR comment on GitHub.
 * Persists the GitHub comment ID to DB for later verification.
 */
export async function postSingleComment(
  prisma: PrismaClient,
  prId: string,
  comment: PostCommentBody
): Promise<{ id: number; html_url: string }> {
  const pr = await loadPrWithConnection(prisma, prId);
  const { client, owner, repo } = buildClient(pr);
  const { commitSha, reviewId } = await resolveReviewCommitSha(prisma, prId, pr, client, owner, repo, comment.reviewId);

  if (!reviewId) {
    throw new ServiceError("Cannot post comment: PR has no associated AI review", 400);
  }

  let result: { id: number; html_url: string };
  try {
    if (comment.subjectType === "file") {
      // File-level comment — line is NOT in the diff, include line ref in body
      const lineRef = comment.endLine
        ? `> **Lines ${comment.line}–${comment.endLine}**`
        : `> **Line ${comment.line}**`;
      result = await client.createReviewComment(owner, repo, pr.ghePrId, {
        commitId: commitSha,
        path: comment.path,
        body: `${lineRef}\n\n${comment.body}`,
        subjectType: "file",
      });
    } else {
      // Inline comment — GitHub API: `line` = end line, `startLine` = start line for multi-line
      result = await client.createReviewComment(owner, repo, pr.ghePrId, {
        commitId: commitSha,
        path: comment.path,
        line: comment.endLine ?? comment.line,
        body: comment.body,
        ...(comment.endLine && { startLine: comment.line, startSide: "RIGHT" as const }),
      });
    }
  } catch (err) {
    throw toUserFriendlyError(err);
  }

  await persistPostedComment(prisma, reviewId, comment.findingId, result.id, result.html_url);

  return result;
}

/**
 * Batch submit selected findings as a single GitHub PR review.
 * Persists all posted findings to DB (without per-comment IDs — batch API returns only a review ID).
 */
export async function submitBatchReview(
  prisma: PrismaClient,
  prId: string,
  review: SubmitReviewBody,
  log?: { error: (obj: object, msg: string) => void }
): Promise<{ id: number; html_url: string; postedCount: number }> {
  const pr = await loadPrWithConnection(prisma, prId);
  const { client, owner, repo } = buildClient(pr);
  const { commitSha, reviewId } = await resolveReviewCommitSha(prisma, prId, pr, client, owner, repo);

  if (!reviewId) {
    throw new ServiceError("Cannot submit review: PR has no associated AI review", 400);
  }

  let result: { id: number; html_url: string };
  try {
    result = await client.createReview(owner, repo, pr.ghePrId, {
      commitId: commitSha,
      event: review.event,
      body: review.body,
      comments: review.findings.map((f) => ({
        path: f.path,
        line: f.endLine ?? f.line, // GitHub API: line = end line for multi-line
        body: f.body,
        ...(f.endLine && { start_line: f.line, start_side: "RIGHT" as const }),
      })),
    });
  } catch (err) {
    throw toUserFriendlyError(err);
  }

  // Batch: persist all findings with the review URL (no per-comment IDs available from batch API).
  const persistResults = await Promise.allSettled(
    review.findings.map((f) =>
      persistPostedComment(prisma, reviewId, f.findingId, null, result.html_url)
    )
  );

  const failedCount = persistResults.filter((r) => r.status === "rejected").length;
  if (failedCount > 0) {
    log?.error({ failedCount, total: review.findings.length }, "[submit-batch] Failed to persist some posted comments to DB");
  }

  return { ...result, postedCount: review.findings.length };
}

function toDto(r: {
  id: string;
  reviewId: string;
  findingId: string;
  githubCommentId: string | null;
  githubHtmlUrl: string;
  postedAt: Date;
  deletedOnGithub: boolean;
  resolutionStatus: string | null;
  resolutionReason: string | null;
  resolvedAt: Date | null;
  resolvedByCommitSha: string | null;
  carriedFromReviewId: string | null;
  githubThreadResolved: boolean;
  githubThreadResolvedAt: Date | null;
  dismissedAt: Date | null;
  dismissedBy: string | null;
  dismissalKeyword: string | null;
  replyCount: number;
  lastReplyAt: Date | null;
  lastReplyAuthor: string | null;
  lastReplyBody: string | null;
  repliesSyncedAt: Date | null;
}): PostedFindingCommentDto {
  return {
    id: r.id,
    reviewId: r.reviewId,
    findingId: r.findingId,
    githubCommentId: r.githubCommentId,
    githubHtmlUrl: r.githubHtmlUrl,
    postedAt: r.postedAt.toISOString(),
    deletedOnGithub: r.deletedOnGithub,
    resolutionStatus: r.resolutionStatus as ResolutionStatus | null,
    resolutionReason: r.resolutionReason as ResolutionReason | null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolvedByCommitSha: r.resolvedByCommitSha,
    carriedFromReviewId: r.carriedFromReviewId,
    githubThreadResolved: r.githubThreadResolved,
    githubThreadResolvedAt: r.githubThreadResolvedAt?.toISOString() ?? null,
    dismissedAt: r.dismissedAt?.toISOString() ?? null,
    dismissedBy: r.dismissedBy,
    dismissalKeyword: r.dismissalKeyword,
    replyCount: r.replyCount,
    lastReplyAt: r.lastReplyAt?.toISOString() ?? null,
    lastReplyAuthor: r.lastReplyAuthor,
    lastReplyBody: r.lastReplyBody,
    repliesSyncedAt: r.repliesSyncedAt?.toISOString() ?? null,
  };
}

/**
 * List posted finding comments, optionally scoped to a specific reviewId.
 * When no reviewId is given, uses the latest completed review for the PR.
 */
export async function listPostedComments(
  prisma: PrismaClient,
  prId: string,
  reviewId?: string
): Promise<PostedFindingCommentDto[]> {
  let scopedReviewId = reviewId;
  if (scopedReviewId) {
    // Validate the review belongs to this PR to prevent IDOR
    const review = await prisma.aiReview.findFirst({
      where: { id: scopedReviewId, pullRequestId: prId },
      select: { id: true },
    });
    if (!review) return [];
  } else {
    const latestReview = await prisma.aiReview.findFirst({
      where: { pullRequestId: prId, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latestReview) return [];
    scopedReviewId = latestReview.id;
  }

  const records = await prisma.postedFindingComment.findMany({
    where: { reviewId: scopedReviewId },
  });
  return records.map(toDto);
}

/**
 * Verify whether a previously posted finding comment still exists on GitHub.
 * If deleted, marks deletedOnGithub=true in DB (frontend query invalidation re-enables "Post to GitHub").
 * Batch-submitted findings (no githubCommentId) are assumed to still exist.
 */
export async function verifyFindingComment(
  prisma: PrismaClient,
  prId: string,
  findingId: string,
  reviewId?: string
): Promise<{ exists: boolean; htmlUrl?: string }> {
  const resolvedReviewId = await resolveReviewId(prisma, prId, reviewId);

  const record = await prisma.postedFindingComment.findUnique({
    where: { reviewId_findingId: { reviewId: resolvedReviewId, findingId } },
  });

  if (!record) {
    throw new ServiceError("No posted comment found for this finding", 404);
  }

  // Batch-submitted comments have no per-comment ID — verify is not supported
  if (record.githubCommentId === null) {
    return { exists: true, htmlUrl: record.githubHtmlUrl };
  }

  const pr = await loadPrWithConnection(prisma, prId);
  const { client, owner, repo } = buildClient(pr);
  // Parse back to number for the API call — safe because GitHub IDs fit within Number.MAX_SAFE_INTEGER
  const ghComment = await client.getReviewComment(owner, repo, Number(record.githubCommentId));

  if (!ghComment) {
    await prisma.postedFindingComment.update({
      where: { id: record.id },
      data: { deletedOnGithub: true },
    });
    return { exists: false };
  }

  return { exists: true, htmlUrl: ghComment.html_url };
}

/**
 * Delete a previously posted finding comment from GitHub.
 * Marks deletedOnGithub=true in DB so the "Post to GitHub" button re-enables.
 * Batch-submitted findings (no githubCommentId) cannot be deleted individually.
 */
export async function deleteFindingComment(
  prisma: PrismaClient,
  prId: string,
  findingId: string,
  reviewId?: string
): Promise<{ deleted: boolean }> {
  const resolvedReviewId = await resolveReviewId(prisma, prId, reviewId);

  const record = await prisma.postedFindingComment.findUnique({
    where: { reviewId_findingId: { reviewId: resolvedReviewId, findingId } },
  });

  if (!record) {
    throw new ServiceError("No posted comment found for this finding", 404);
  }

  if (record.githubCommentId === null) {
    throw new ServiceError(
      "Cannot delete batch-submitted comment — no individual GitHub comment ID",
      400
    );
  }

  const pr = await loadPrWithConnection(prisma, prId);
  const { client, owner, repo } = buildClient(pr);

  const wasDeleted = await client.deleteReviewComment(
    owner, repo, Number(record.githubCommentId)
  );

  // Mark as deleted regardless (true = just deleted, false = already gone)
  await prisma.postedFindingComment.update({
    where: { id: record.id },
    data: { deletedOnGithub: true },
  });

  return { deleted: wasDeleted };
}
