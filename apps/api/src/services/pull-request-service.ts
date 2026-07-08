/**
 * Pull request sync and query service.
 * Handles upsert of PR data from GHE polling results, state-change detection,
 * and filtered/paginated listing for the PR dashboard.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { GhePullRequest, GheClient } from "@repo-sentinel/ghe-client";
import type { Server as SocketServer } from "socket.io";
import { PrState } from "@repo-sentinel/types";
import type { ListPullRequestsQuery } from "../schemas/pull-request-schemas.js";
import { emitNewPr, emitPrUpdated, emitPrReviewOutdated } from "./notification-service.js";
import { triggerReview } from "./ai-review-service.js";

// ---------------------------------------------------------------------------
// Mapping helper
// ---------------------------------------------------------------------------

/**
 * Derive Prisma PrState from GHE pull request fields.
 */
function mapGheStateToPrState(pull: GhePullRequest): PrState {
  if (pull.state === "open") return PrState.OPEN;
  if (pull.merged_at) return PrState.MERGED;
  return PrState.CLOSED;
}

/**
 * Map a GHE pull request object to Prisma create/update data.
 * Diff stats (additions/deletions/changedFiles) are available only when
 * fetched via getPullRequest(); the list endpoint returns 0 — acceptable for
 * initial discovery; a subsequent detail fetch enriches those fields.
 */
export function mapGhePullToPrisma(
  repoId: string,
  pull: GhePullRequest
): {
  repoId: string;
  ghePrId: number;
  ghePrNodeId: string;
  title: string;
  body: string | null;
  authorLogin: string;
  authorAvatar: string | null;
  state: PrState;
  headRef: string;
  baseRef: string;
  htmlUrl: string;
  diffUrl: string;
  createdAtGhe: Date;
  updatedAtGhe: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  headCommitSha: string;
  draft: boolean;
} {
  return {
    repoId,
    ghePrId: pull.number,
    ghePrNodeId: pull.node_id,
    title: pull.title,
    body: pull.body,
    authorLogin: pull.user.login,
    authorAvatar: pull.user.avatar_url || null,
    state: mapGheStateToPrState(pull),
    headRef: pull.head.ref,
    baseRef: pull.base.ref,
    htmlUrl: pull.html_url,
    diffUrl: pull.diff_url,
    createdAtGhe: new Date(pull.created_at),
    updatedAtGhe: new Date(pull.updated_at),
    mergedAt: pull.merged_at ? new Date(pull.merged_at) : null,
    closedAt: pull.closed_at ? new Date(pull.closed_at) : null,
    additions: pull.additions ?? 0,
    deletions: pull.deletions ?? 0,
    changedFiles: pull.changed_files ?? 0,
    headCommitSha: pull.head.sha,
    draft: pull.draft ?? false,
  };
}

// ---------------------------------------------------------------------------
// Auto-review helper
// ---------------------------------------------------------------------------

/** Parse a comma-separated setting value into a lowercase trimmed array */
function parseCommaSetting(value: string | undefined | null): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}

/** Check if a PR's state+draft matches a list of allowed statuses (OPEN, DRAFT) */
function matchesPrStatus(prState: string, isDraft: boolean, allowedStatuses: string[]): boolean {
  if (allowedStatuses.length === 0) return true; // no filter = allow all
  if (isDraft && allowedStatuses.includes("DRAFT")) return true;
  if (prState === "OPEN" && !isDraft && allowedStatuses.includes("OPEN")) return true;
  return false;
}

/**
 * Check if auto-review is enabled and trigger AI review for a new PR.
 * Fire-and-forget — errors are logged but don't break polling.
 */
async function autoTriggerReview(
  prisma: PrismaClient,
  prId: string,
  prState: string,
  isDraft: boolean,
  authorLogin: string,
  io: SocketServer
): Promise<void> {
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: ["ai.review.autoReview", "ai.review.autoReviewStatuses", "ai.review.autoReviewAuthors"] } },
    });
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

    if (settingsMap.get("ai.review.autoReview") !== "1") return;

    // Check PR status filter
    const allowedStatuses = parseCommaSetting(settingsMap.get("ai.review.autoReviewStatuses") ?? "OPEN");
    if (!matchesPrStatus(prState, isDraft, allowedStatuses)) {
      console.log(`[auto-review] skipped PR id=${prId}: status ${isDraft ? "DRAFT" : prState} not in [${allowedStatuses}]`);
      return;
    }

    // Check author whitelist
    const authorsRaw = settingsMap.get("ai.review.autoReviewAuthors")?.trim() ?? "";
    if (authorsRaw) {
      const allowedAuthors = authorsRaw.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
      if (allowedAuthors.length > 0 && !allowedAuthors.includes(authorLogin.toLowerCase())) {
        console.log(`[auto-review] skipped PR id=${prId}: author "${authorLogin}" not in whitelist`);
        return;
      }
    }

    await triggerReview(prisma, prId, io);
    console.log(`[auto-review] triggered for new PR id=${prId} by ${authorLogin}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn(`[auto-review] skipped PR id=${prId}: ${message}`);
  }
}

/**
 * Check if auto re-run is enabled and trigger AI review for a PR with new commits.
 * Fire-and-forget — errors are logged but don't break polling.
 */
async function autoRerunReview(
  prisma: PrismaClient,
  prId: string,
  prState: string,
  isDraft: boolean,
  io: SocketServer
): Promise<void> {
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: ["ai.review.autoRerunReview", "ai.review.autoRerunReviewStatuses"] } },
    });
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

    if (settingsMap.get("ai.review.autoRerunReview") !== "1") return;

    // Check PR status filter
    const allowedStatuses = parseCommaSetting(settingsMap.get("ai.review.autoRerunReviewStatuses") ?? "OPEN");
    if (!matchesPrStatus(prState, isDraft, allowedStatuses)) {
      console.log(`[auto-rerun] skipped PR id=${prId}: status ${isDraft ? "DRAFT" : prState} not in [${allowedStatuses}]`);
      return;
    }

    await triggerReview(prisma, prId, io, undefined, { skipCooldown: true });
    console.log(`[auto-rerun] triggered for PR id=${prId} (new commits)`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn(`[auto-rerun] skipped PR id=${prId}: ${message}`);
  }
}

/**
 * Catch-up for PRs stuck in UPDATED status — if auto re-run is enabled
 * and no review covers the current commit, trigger one.
 */
async function autoRerunCatchUp(
  prisma: PrismaClient,
  prId: string,
  prState: string,
  isDraft: boolean,
  currentCommitSha: string,
  io: SocketServer
): Promise<void> {
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: ["ai.review.autoRerunReview", "ai.review.autoRerunReviewStatuses"] } },
    });
    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

    if (settingsMap.get("ai.review.autoRerunReview") !== "1") return;

    const allowedStatuses = parseCommaSetting(settingsMap.get("ai.review.autoRerunReviewStatuses") ?? "OPEN");
    if (!matchesPrStatus(prState, isDraft, allowedStatuses)) return;

    // Check if there's already a review for the current commit (or one in-flight)
    const existingReview = await prisma.aiReview.findFirst({
      where: {
        pullRequestId: prId,
        OR: [
          { commitSha: currentCommitSha },
          { status: { in: ["QUEUED", "RUNNING"] } },
        ],
      },
    });
    if (existingReview) return; // already reviewed or in-flight

    await triggerReview(prisma, prId, io, undefined, { skipCooldown: true });
    console.log(`[auto-rerun-catchup] triggered for PR id=${prId} (UPDATED, no review for commit ${currentCommitSha.substring(0, 8)})`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.warn(`[auto-rerun-catchup] skipped PR id=${prId}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Sync — called by polling-service after a successful GHE response
// ---------------------------------------------------------------------------

/**
 * Upsert PRs from a GHE polling result into the database.
 * Emits Socket.io events for new and state-changed PRs.
 */
export async function syncPullRequests(
  prisma: PrismaClient,
  repoId: string,
  ghePulls: GhePullRequest[],
  io: SocketServer
): Promise<void> {
  const existing = await prisma.pullRequest.findMany({
    where: { repoId },
    select: { id: true, ghePrId: true, state: true, draft: true, updatedAtGhe: true, additions: true, deletions: true, changedFiles: true, headCommitSha: true, reviewStatus: true },
  });

  const existingMap = new Map(
    existing.map((pr) => [pr.ghePrId, pr])
  );

  for (const ghePull of ghePulls) {
    const data = mapGhePullToPrisma(repoId, ghePull);
    const existingPr = existingMap.get(ghePull.number);

    if (!existingPr) {
      // New PR — insert and notify
      const created = await prisma.pullRequest.create({ data });
      emitNewPr(io, prisma, created as unknown as Record<string, unknown>, repoId);

      // Auto-review: trigger AI review for new PRs matching status filter
      void autoTriggerReview(prisma, created.id, data.state, data.draft, data.authorLogin, io);
    } else {
      const gheUpdatedAt = new Date(ghePull.updated_at).toISOString();
      const dbUpdatedAt = existingPr.updatedAtGhe.toISOString();

      // Also update when diff stats are missing (0/0/0) but enriched data has them
      const missingDiffStats =
        existingPr.additions === 0 && existingPr.deletions === 0 && existingPr.changedFiles === 0
        && (data.additions > 0 || data.deletions > 0 || data.changedFiles > 0);

      // Backfill headCommitSha for PRs synced before this field existed
      const missingCommitSha = !existingPr.headCommitSha && !!data.headCommitSha;

      // Detect new commits on a previously reviewed PR
      const hasNewCommits =
        !!existingPr.headCommitSha &&
        !!data.headCommitSha &&
        existingPr.headCommitSha !== data.headCommitSha;

      // Mark as UPDATED only if the PR was already reviewed (REVIEWED or UPDATED)
      const isReviewOutdated = hasNewCommits &&
        (existingPr.reviewStatus === "REVIEWED" || existingPr.reviewStatus === "UPDATED");

      if (gheUpdatedAt !== dbUpdatedAt || missingDiffStats || missingCommitSha || isReviewOutdated) {
        const updated = await prisma.pullRequest.update({
          where: { repoId_ghePrId: { repoId, ghePrId: ghePull.number } },
          data: {
            ...data,
            ...(isReviewOutdated ? { reviewStatus: "UPDATED" } : {}),
          },
        });
        if (isReviewOutdated) {
          emitPrReviewOutdated(io, prisma, existingPr.id, data.title, existingPr.headCommitSha!, data.headCommitSha);
          // Auto re-run: trigger AI review for PRs with new commits
          void autoRerunReview(prisma, existingPr.id, data.state, data.draft, io);
        }
        if (updated.state !== existingPr.state) {
          emitPrUpdated(
            io,
            prisma,
            updated as unknown as Record<string, unknown>,
            { oldState: existingPr.state, newState: updated.state }
          );
        }
      }

      // Catch-up: PR in UPDATED status (set by review job or prior poll) but no re-run triggered yet.
      if (!isReviewOutdated && existingPr.reviewStatus === "UPDATED") {
        void autoRerunCatchUp(prisma, existingPr.id, data.state, data.draft, data.headCommitSha, io);
      }

      // Catch-up: auto-trigger review for existing PRs still in PENDING status
      if (existingPr.reviewStatus === "PENDING") {
        void autoTriggerReview(prisma, existingPr.id, data.state, data.draft, data.authorLogin, io);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Reconcile — detect stale OPEN PRs that disappeared from the open-PR response
// ---------------------------------------------------------------------------

/**
 * Reconcile stale OPEN PRs that disappeared from the GitHub open-PR response.
 * When a PR is merged/closed on GitHub, it no longer appears in state="open" listings.
 * This function individually fetches those PRs to detect and apply state changes.
 */
export async function reconcileStalePullRequests(
  prisma: PrismaClient,
  repoId: string,
  fetchedGhePrIds: number[],
  client: GheClient,
  owner: string,
  repoName: string,
  io: SocketServer
): Promise<void> {
  // 1. Find OPEN PRs in DB not present in the fetched set
  const stalePrs = await prisma.pullRequest.findMany({
    where: {
      repoId,
      state: PrState.OPEN,
      ghePrId: { notIn: fetchedGhePrIds },
    },
    select: { id: true, ghePrId: true, state: true },
  });

  if (stalePrs.length === 0) return;

  // 2. Individually fetch each stale PR from GitHub
  for (const stalePr of stalePrs) {
    try {
      const ghePull = await client.getPullRequest(owner, repoName, stalePr.ghePrId);
      const data = mapGhePullToPrisma(repoId, ghePull);

      // Only update if state actually changed from OPEN
      if (data.state !== PrState.OPEN) {
        const updated = await prisma.pullRequest.update({
          where: { repoId_ghePrId: { repoId, ghePrId: stalePr.ghePrId } },
          data,
        });
        emitPrUpdated(
          io,
          prisma,
          updated as unknown as Record<string, unknown>,
          { oldState: stalePr.state, newState: updated.state }
        );
      }
    } catch (err: unknown) {
      // Non-fatal: PR may have been deleted, or API error
      const message = err instanceof Error ? err.message : "Unknown error";
      console.warn(`[reconcile] Failed to fetch PR #${stalePr.ghePrId} for repo=${repoId}: ${message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Query — for the PR list and detail endpoints
// ---------------------------------------------------------------------------

/**
 * List pull requests with optional filtering, sorting, and pagination.
 * Returns records plus total count for pagination metadata.
 */
export async function listPullRequests(
  prisma: PrismaClient,
  filters: ListPullRequestsQuery
): Promise<{ pullRequests: unknown[]; total: number }> {
  const { repoId, state, author, reviewStatus, sort, order, page, limit } =
    filters;

  // DRAFT is a virtual state: state=OPEN + draft=true
  const stateFilter =
    state === "DRAFT"
      ? { state: "OPEN" as const, draft: true }
      : state
        ? { state }
        : {};

  const where = {
    ...(repoId && { repoId }),
    ...stateFilter,
    ...(author && { authorLogin: { contains: author, mode: "insensitive" as const } }),
    ...(reviewStatus && { reviewStatus }),
  };

  const [rawPrs, total] = await Promise.all([
    prisma.pullRequest.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        repo: { select: { owner: true, name: true, fullName: true } },
        aiReviews: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, score: true, status: true, commitSha: true },
        },
      },
    }),
    prisma.pullRequest.count({ where }),
  ]);

  const pullRequests = rawPrs.map(({ aiReviews, ...pr }) => ({
    ...pr,
    latestReview: aiReviews[0] ?? null,
  }));

  return { pullRequests, total };
}

/**
 * Fetch a single pull request by internal ID, including its AI reviews.
 */
export async function getPullRequestDetail(
  prisma: PrismaClient,
  id: string
): Promise<unknown> {
  const pr = await prisma.pullRequest.findUnique({
    where: { id },
    include: {
      repo: { select: { owner: true, name: true, fullName: true, connectionId: true } },
    },
  });
  return pr ?? null;
}

/** Set or clear the manual JIRA ticket-link override for a PR. */
export async function setJiraTicketOverride(
  prisma: PrismaClient,
  prId: string,
  ticketKey: string | null
): Promise<void> {
  await prisma.pullRequest.update({
    where: { id: prId },
    data: { jiraTicketKeyOverride: ticketKey ? ticketKey.toUpperCase() : null },
  });
}

/**
 * Aggregate stats for the dashboard summary cards.
 */
export async function getDashboardStats(
  prisma: PrismaClient
): Promise<{
  totalWatched: number;
  openPrs: number;
  newToday: number;
  pendingReviews: number;
}> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [totalWatched, openPrs, newToday, pendingReviews] = await Promise.all([
    prisma.watchedRepo.count(),
    prisma.pullRequest.count({ where: { state: PrState.OPEN } }),
    prisma.pullRequest.count({ where: { firstSeenAt: { gte: startOfDay } } }),
    prisma.pullRequest.count({ where: { reviewStatus: "PENDING", state: PrState.OPEN } }),
  ]);

  return { totalWatched, openPrs, newToday, pendingReviews };
}
