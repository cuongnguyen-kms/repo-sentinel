/**
 * DTOs and input types for AI-powered code review.
 */

import type { AiReviewStatus } from "./enums.js";

/** Severity levels for code review findings (MVP subset — JIRA/wiki-specific severities dropped). */
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

/** Single code review finding from AI analysis */
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
  /** Content-based fingerprint for cross-review matching (sha256 of file:severity:normalizedTitle) */
  fingerprint?: string;
}

/** Complete structured code review result from Claude */
export interface CodeReviewResult {
  score: number;
  summary: string;
  findings: CodeReviewFinding[];
  stats: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
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
  /** Count of findings parsed from codeReviewJson */
  findingsCount?: number;
  findingsBreakdown?: FindingsBreakdown;
}

/** Per-severity finding counts for review summary chips. */
export interface FindingsBreakdown {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
  info?: number;
}

/** Lightweight review summary for history lists — excludes heavy blob fields (output, report, diffContent, codeReviewJson, command, terminalLog). */
export interface AiReviewSummaryDto {
  id: string;
  pullRequestId: string | null;
  commitSha: string;
  status: AiReviewStatus;
  reviewPhase: string | null;
  summary: string | null;
  score: number | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  findingsCount?: number;
  findingsBreakdown?: FindingsBreakdown;
}

export interface TriggerReviewInput {
  pullRequestId: string;
}

/** Auto-resolution status for a posted/tracked finding comment. */
export type ResolutionStatus = "OPEN" | "RESOLVED" | "WONT_FIX";

/** Reason a finding was resolved — stored in PostedFindingComment.resolutionReason */
export type ResolutionReason =
  | "CODE_FIX"
  | "LINE_NOT_IN_DIFF"
  | "NO_LONGER_FLAGGED"
  | "MANUAL"
  | "SUPERSEDED";

/** A reply to a posted GitHub finding comment, synced from GitHub. */
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

/** A finding comment that was posted to GitHub, as returned by the API. */
export interface PostedFindingCommentDto {
  id: string;
  reviewId: string;
  findingId: string;
  /** GitHub review comment ID — null for batch-submitted findings; stored as string to avoid INT4 overflow */
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

/** Summary of a single resolved finding for run-over-run comparison */
export interface ResolvedFindingSummary {
  findingId: string;
  title: string;
  file: string;
  line: number;
  severity: FindingSeverity;
  reason: ResolutionReason;
  resolvedByCommitSha?: string | null;
  /** Direct link to the GitHub review comment, if available */
  githubHtmlUrl?: string | null;
  /** Review run that originally contained this finding (for cross-review navigation) */
  sourceReviewId?: string;
  /** True when the GitHub review thread was also resolved on GitHub */
  githubThreadResolved?: boolean;
}

/** Summary of a single carried-over finding for run-over-run comparison */
export interface CarriedOverFindingSummary {
  findingId: string;
  title: string;
  file: string;
  line: number;
  severity: FindingSeverity;
}

/** Summary of an unresolved open comment from a prior review */
export interface OpenCommentSummary {
  findingId: string;
  title: string;
  file: string;
  line: number;
  severity: FindingSeverity;
  /** Direct link to the GitHub review comment, if available */
  githubHtmlUrl?: string | null;
  /** Review run that originally contained this finding */
  sourceReviewId?: string;
  /** Original reviewId if this comment was carried over to the current review */
  carriedFromReviewId?: string | null;
  /** ReviewId of the latest review where this finding was injected (carry-over target) */
  carriedToReviewId?: string | null;
  /** FindingId in the latest review after carry-over (e.g. "carried-F5") */
  carriedToFindingId?: string | null;
  /** True when the GitHub review thread was resolved on GitHub */
  githubThreadResolved?: boolean;
}

/** Run-over-run comparison between two review runs on the same PR */
export interface ReviewComparisonSummary {
  previousReviewId: string | null;
  resolved: ResolvedFindingSummary[];
  resolvedCount: number;
  newFindingIds: string[];
  newCount: number;
  carriedOverIds: string[];
  carriedOver: CarriedOverFindingSummary[];
  carriedOverCount: number;
  /** GitHub open comments resolved by commit-diff auto-resolution during this review run */
  openCommentsResolved?: number;
  /** Details of each auto-resolved GitHub comment (title/file/line/severity/reason) */
  openCommentsResolvedDetails?: ResolvedFindingSummary[];
  /** GitHub open comments still unresolved across all prior reviews */
  openCommentsStillOpen?: number;
  /** Details of each still-unresolved open comment */
  openCommentsStillOpenDetails?: OpenCommentSummary[];
}

/** Open comment entry written to JSON file for AI-driven resolution */
export interface OpenCommentEntry {
  /** PostedFindingComment.id if finding was posted to GitHub, else "reviewId:findingId" */
  commentId: string;
  /** Original finding ID from the review (F1, F2, etc.) */
  findingId: string;
  /** Finding title from codeReviewJson */
  title: string;
  /** File path relative to repo root */
  file: string;
  /** Line number in the file */
  line: number;
  /** Severity level */
  severity: string;
  /** Full finding comment/description */
  comment: string;
  /** Direct link to the GitHub comment */
  githubHtmlUrl: string;
  /** Current status — "OPEN" for active findings, "WONT_FIX" for intentionally suppressed ones */
  status: "OPEN" | "WONT_FIX";
  /** AI fills this: "RESOLVED" or "STILL_OPEN" */
  resolution: OpenCommentResolution | null;
  /** AI fills this: "CODE_FIX" | "LINE_NOT_IN_DIFF" | "NO_LONGER_FLAGGED" */
  resolutionReason: ResolutionReason | null;
  /** AI fills this for STILL_OPEN entries: updated line number in current code */
  updatedLine?: number | null;
}

/** Resolution values Claude may write back for an open comment entry. */
export type OpenCommentResolution = "RESOLVED" | "STILL_OPEN";

/** Input for resolving GitHub review threads */
export interface ResolveGithubThreadsInput {
  findingIds: string[];
  reviewId?: string;
}

/** Result of GitHub thread resolution */
export interface ResolveGithubThreadsResult {
  resolved: number;
  failed: number;
  skipped: number;
  errors: Array<{ findingId: string; error: string }>;
}
