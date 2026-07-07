/**
 * DTOs mirroring @repo-sentinel/types — hand-ported for the Angular build.
 */

import type { AiReviewStatus, NotificationStatus, NotificationType, PrState, ReviewStatus } from './enums';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  image?: string | null;
}

export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface GheConnectionDto {
  id: string;
  hostname: string;
  username: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  username?: string;
}

// ---------------------------------------------------------------------------
// Repos
// ---------------------------------------------------------------------------

export interface WatchedRepoDto {
  id: string;
  connectionId: string;
  owner: string;
  name: string;
  fullName: string;
  pollingInterval: number;
  lastPolledAt: string | null;
  isActive: boolean;
  status: 'active' | 'paused' | 'error';
  createdAt: string;
  promptTemplate: string | null;
  systemPromptTemplate: string | null;
  openPrCount?: number;
}

export interface GheRepoItem {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string | null;
  updatedAt: string;
}

export interface BrowseReposResponse {
  repos: GheRepoItem[];
  page: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

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
  repo?: { owner: string; name: string; fullName: string };
  latestReview?: { id: string; score: number | null; status: AiReviewStatus; commitSha: string } | null;
  firstSeenAt: string;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalWatched: number;
  openPrs: number;
  newToday: number;
  pendingReviews: number;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CodeReviewFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  file: string;
  line: number;
  endLine?: number;
  comment: string;
  suggestion?: string;
  codeContext?: string;
  fingerprint?: string;
}

export interface CodeReviewResult {
  score: number;
  summary: string;
  findings: CodeReviewFinding[];
  stats: { critical: number; high: number; medium: number; low: number; info: number };
}

export interface FindingsBreakdown {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
}

export interface AiReviewDto {
  id: string;
  pullRequestId: string | null;
  commitSha: string;
  status: AiReviewStatus;
  command: string;
  output: string | null;
  report: string | null;
  reviewPhase: string | null;
  summary: string | null;
  score: number | null;
  codeReviewJson: string | null;
  diffContent: string | null;
  terminalLog: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  findingsCount?: number;
  findingsBreakdown?: FindingsBreakdown;
  postedCommentsCount?: number;
}

export type AiReviewSummaryDto = Omit<AiReviewDto, 'command' | 'output' | 'report' | 'codeReviewJson' | 'diffContent' | 'terminalLog'>;

// ---------------------------------------------------------------------------
// Finding comments, resolution, and review comparison
// ---------------------------------------------------------------------------

export type ResolutionStatus = 'OPEN' | 'RESOLVED' | 'WONT_FIX';

export type ResolutionReason =
  | 'CODE_FIX'
  | 'LINE_NOT_IN_DIFF'
  | 'NO_LONGER_FLAGGED'
  | 'MANUAL'
  | 'SUPERSEDED';

export interface FindingReplyDto {
  id: string;
  postedCommentId: string;
  githubCommentId: string;
  githubHtmlUrl: string;
  author: string;
  body: string;
  isDismissal: boolean;
  matchedKeyword: string | null;
  createdAtGithub: string;
  syncedAt: string;
}

export interface PostedFindingCommentDto {
  id: string;
  reviewId: string;
  findingId: string;
  githubCommentId: string | null;
  githubHtmlUrl: string;
  postedAt: string;
  deletedOnGithub: boolean;
  resolutionStatus: ResolutionStatus | null;
  resolutionReason: ResolutionReason | null;
  resolvedAt: string | null;
  resolvedByCommitSha: string | null;
  carriedFromReviewId: string | null;
  githubThreadResolved: boolean;
  githubThreadResolvedAt: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  dismissalKeyword: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  lastReplyAuthor: string | null;
  lastReplyBody: string | null;
  repliesSyncedAt: string | null;
}

export interface ResolvedFindingSummary {
  findingId: string;
  title: string;
  file: string;
  line: number;
  severity: FindingSeverity;
  reason: ResolutionReason;
  resolvedByCommitSha?: string | null;
  githubHtmlUrl?: string | null;
  sourceReviewId?: string;
  githubThreadResolved?: boolean;
}

export interface CarriedOverFindingSummary {
  findingId: string;
  title: string;
  file: string;
  line: number;
  severity: FindingSeverity;
}

export interface OpenCommentSummary {
  findingId: string;
  title: string;
  file: string;
  line: number;
  severity: FindingSeverity;
  githubHtmlUrl?: string | null;
  sourceReviewId?: string;
  carriedFromReviewId?: string | null;
  carriedToReviewId?: string | null;
  carriedToFindingId?: string | null;
  githubThreadResolved?: boolean;
}

export interface ReviewComparisonSummary {
  previousReviewId: string | null;
  resolved: ResolvedFindingSummary[];
  resolvedCount: number;
  newFindingIds: string[];
  newCount: number;
  carriedOverIds: string[];
  carriedOver: CarriedOverFindingSummary[];
  carriedOverCount: number;
  openCommentsResolved?: number;
  openCommentsResolvedDetails?: ResolvedFindingSummary[];
  openCommentsStillOpen?: number;
  openCommentsStillOpenDetails?: OpenCommentSummary[];
}

export interface ResolveGithubThreadsResult {
  resolved: number;
  failed: number;
  skipped: number;
  errors: Array<{ findingId: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationDto {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  title: string;
  message: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}
