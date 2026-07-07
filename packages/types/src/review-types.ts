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
