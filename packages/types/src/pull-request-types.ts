/**
 * DTOs for pull request tracking.
 * Mirrors all fields from the PullRequest Prisma model.
 */

import type { PrState, ReviewStatus } from "./enums.js";
import type { AiReviewDto } from "./review-types.js";

export interface PullRequestDto {
  id: string;
  repoId: string;
  ghePrId: number;
  ghePrNodeId: string | null;
  title: string;
  body: string | null;
  authorLogin: string;
  authorAvatar: string | null;
  state: PrState;
  headRef: string;
  baseRef: string;
  htmlUrl: string;
  diffUrl: string;
  createdAtGhe: string;
  updatedAtGhe: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  headCommitSha: string | null;
  draft: boolean;
  reviewStatus: ReviewStatus;
  jiraTicketKeyOverride: string | null;
  /** Repo summary — included when API returns PR list or detail */
  repo?: { owner: string; name: string; fullName: string };
  /** All reviews for this PR (1:N) — included on PR detail */
  aiReviews?: AiReviewDto[];
  /** Latest review (computed by API) — convenience field for detail view */
  latestReview?: AiReviewDto | null;
  firstSeenAt: string;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListPullRequestsOptions {
  repoId?: string;
  state?: PrState | "DRAFT";
  reviewStatus?: ReviewStatus;
  author?: string;
  sort?: "createdAtGhe" | "updatedAtGhe" | "additions" | "deletions";
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface DashboardStats {
  totalWatched: number;
  openPrs: number;
  newToday: number;
  pendingReviews: number;
}
