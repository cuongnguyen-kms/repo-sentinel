/**
 * DTOs for the merged-PR comment tracking report (grouped by sprint).
 */

export interface SprintDto {
  label: string;
  start: string;
  end: string;
}

export interface MergedPrCommentCounts {
  open: number;
  fixedCode: number;
  noLongerFlagged: number;
  invalidComment: number;
  notFixNow: number;
  byDesign: number;
  acceptedRisk: number;
  noReply: number;
  otherResolved: number;
  otherDismissed: number;
  total: number;
}

export interface MergedPrReportSummary extends MergedPrCommentCounts {
  totalMergedPrs: number;
}

export interface MergedPrCommentDto {
  id: string;
  findingTitle: string;
  findingSeverity: string;
  findingFile: string;
  findingLine: number;
  resolutionStatus: string;
  resolutionReason: string | null;
  category: string;
  replyCount: number;
  lastReplyBody: string | null;
  dismissalKeyword: string | null;
  githubHtmlUrl: string;
}

export interface MergedPrReportRow {
  prId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  authorLogin: string;
  repoFullName: string;
  mergedAt: string | null;
  counts: MergedPrCommentCounts;
  comments: MergedPrCommentDto[];
}

export interface MergedPrCommentsReport {
  summary: MergedPrReportSummary;
  prs: MergedPrReportRow[];
}
