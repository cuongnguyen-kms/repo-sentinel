/**
 * Computes a run-over-run delta between the current review and the previous
 * completed review for the same PR. Shows resolved, new, and carried-over findings.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type {
  CodeReviewFinding,
  ReviewComparisonSummary,
  ResolvedFindingSummary,
  CarriedOverFindingSummary,
  OpenCommentSummary,
  ResolutionReason,
  FindingSeverity,
} from "@repo-sentinel/types";
import { getMatchKey, hashFingerprint } from "./finding-fingerprint-service.js";

/** Parse codeReviewJson into findings array, returning [] on failure. */
function parseFindings(json: string | null): CodeReviewFinding[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as { findings?: CodeReviewFinding[] };
    return parsed.findings ?? [];
  } catch {
    return [];
  }
}

export async function computeReviewComparison(
  prisma: PrismaClient,
  currentReviewId: string
): Promise<ReviewComparisonSummary> {
  const current = await prisma.aiReview.findUnique({
    where: { id: currentReviewId },
    select: { id: true, pullRequestId: true, codeReviewJson: true, createdAt: true, commitSha: true, openCommentsSnapshot: true },
  });

  if (!current?.pullRequestId) {
    return {
      previousReviewId: null,
      resolved: [],
      resolvedCount: 0,
      newFindingIds: [],
      newCount: 0,
      carriedOverIds: [],
      carriedOver: [],
      carriedOverCount: 0,
      openCommentsResolved: 0,
      openCommentsResolvedDetails: [],
      openCommentsStillOpen: 0,
      openCommentsStillOpenDetails: [],
    };
  }

  // Find previous completed review for same PR
  const previous = await prisma.aiReview.findFirst({
    where: {
      pullRequestId: current.pullRequestId,
      status: "COMPLETED",
      id: { not: currentReviewId },
      createdAt: { lt: current.createdAt },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeReviewJson: true },
  });

  const currFindings = parseFindings(current.codeReviewJson);

  const hasRealCommitSha = current.commitSha && current.commitSha !== "unknown";

  // Fetch resolved comment records so we can build detail summaries.
  const resolvedOpenCommentRecords = hasRealCommitSha
    ? await prisma.postedFindingComment.findMany({
        where: {
          review: { pullRequestId: current.pullRequestId, id: { not: currentReviewId } },
          resolvedByCommitSha: current.commitSha,
          resolutionStatus: "RESOLVED",
        },
        select: { id: true, findingId: true, resolutionReason: true, resolvedByCommitSha: true, reviewId: true, githubHtmlUrl: true, githubThreadResolved: true },
      })
    : [];

  // Enrich resolved open comments with finding metadata (title/file/line/severity).
  const openCommentsResolvedDetails: ResolvedFindingSummary[] = [];
  if (resolvedOpenCommentRecords.length > 0) {
    const reviewIds = [...new Set(resolvedOpenCommentRecords.map((c) => c.reviewId))];
    const sourceReviews = await prisma.aiReview.findMany({
      where: { id: { in: reviewIds } },
      select: { id: true, codeReviewJson: true },
    });
    const reviewFindingsIndex = new Map<string, Map<string, CodeReviewFinding>>();
    for (const rev of sourceReviews) {
      const findings = parseFindings(rev.codeReviewJson);
      reviewFindingsIndex.set(rev.id, new Map(findings.map((f) => [f.id, f])));
    }
    for (const c of resolvedOpenCommentRecords) {
      const finding = reviewFindingsIndex.get(c.reviewId)?.get(c.findingId);
      if (!finding) continue;
      openCommentsResolvedDetails.push({
        findingId: c.findingId,
        title: finding.title,
        file: finding.file,
        line: finding.line,
        severity: finding.severity as FindingSeverity,
        reason: (c.resolutionReason ?? "CODE_FIX") as ResolutionReason,
        resolvedByCommitSha: c.resolvedByCommitSha,
        githubHtmlUrl: c.githubHtmlUrl || null,
        sourceReviewId: c.reviewId,
        githubThreadResolved: c.githubThreadResolved,
      });
    }
  }
  const openCommentsResolved = resolvedOpenCommentRecords.length;

  // Derive unresolved open comment details from the snapshot (source of truth).
  const resolvedCommentIdSet = new Set<string>();
  for (const c of resolvedOpenCommentRecords) {
    resolvedCommentIdSet.add(`${c.reviewId}:${c.findingId}`);
    resolvedCommentIdSet.add(c.id); // PostedFindingComment.id format
  }
  let openCommentsStillOpenDetails: OpenCommentSummary[] = [];
  if (current.openCommentsSnapshot) {
    try {
      const snapshot = JSON.parse(current.openCommentsSnapshot) as Array<{
        commentId: string;
        findingId: string;
        title: string;
        file: string;
        line: number;
        severity: string;
        githubHtmlUrl?: string;
        sourceReviewId?: string;
      }>;
      if (Array.isArray(snapshot)) {
        const openRecords = await prisma.postedFindingComment.findMany({
          where: { review: { pullRequestId: current.pullRequestId, id: { not: currentReviewId } }, resolutionStatus: "OPEN" },
          select: { id: true, findingId: true, reviewId: true, githubHtmlUrl: true, githubThreadResolved: true },
        });
        // Also include carried-over records now on the current review (moved by carry-over logic)
        const carriedRecords = await prisma.postedFindingComment.findMany({
          where: { reviewId: currentReviewId, resolutionStatus: "OPEN", carriedFromReviewId: { not: null } },
          select: { id: true, findingId: true, reviewId: true, githubHtmlUrl: true, carriedFromReviewId: true, githubThreadResolved: true },
        });
        const ghUrlByKey = new Map(openRecords.map((r) => [r.reviewId + ":" + r.findingId, r.githubHtmlUrl]));
        const ghUrlById = new Map(openRecords.map((r) => [r.id, r.githubHtmlUrl]));
        const githubResolvedByKey = new Map(openRecords.map((r) => [r.reviewId + ":" + r.findingId, r.githubThreadResolved]));
        const githubResolvedById = new Map(openRecords.map((r) => [r.id, r.githubThreadResolved]));
        const carriedByStrippedId = new Map(carriedRecords.map((r) => [r.findingId.replace(/^carried-/, ""), r]));

        for (const entry of snapshot) {
          if (resolvedCommentIdSet.has(entry.commentId)) continue;
          const colonIdx = entry.commentId.indexOf(":");
          const sourceReviewId = colonIdx > 0 ? entry.commentId.substring(0, colonIdx) : undefined;
          const ghUrl = ghUrlByKey.get(entry.commentId) ?? ghUrlById.get(entry.commentId) ?? entry.githubHtmlUrl ?? null;
          const githubThreadResolved =
            githubResolvedByKey.get(entry.commentId) ?? githubResolvedById.get(entry.commentId) ?? false;
          const entryFp = hashFingerprint(entry.file, entry.severity, entry.title);
          const carriedRecord = carriedByStrippedId.get(entry.findingId) ?? carriedByStrippedId.get(entryFp.substring(0, 16));
          openCommentsStillOpenDetails.push({
            findingId: entry.findingId,
            title: entry.title,
            file: entry.file,
            line: entry.line,
            severity: (entry.severity ?? "info") as FindingSeverity,
            githubHtmlUrl: carriedRecord?.githubHtmlUrl ?? ghUrl ?? null,
            sourceReviewId,
            carriedFromReviewId: carriedRecord?.carriedFromReviewId ?? sourceReviewId ?? null,
            carriedToReviewId: carriedRecord?.reviewId ?? null,
            carriedToFindingId: carriedRecord?.findingId ?? null,
            githubThreadResolved: carriedRecord?.githubThreadResolved ?? githubThreadResolved,
          });
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  if (!previous) {
    // No previous review — all current findings are "new"
    return {
      previousReviewId: null,
      resolved: [],
      resolvedCount: 0,
      newFindingIds: currFindings.map((f) => f.id),
      newCount: currFindings.length,
      carriedOverIds: [],
      carriedOver: [],
      carriedOverCount: 0,
      openCommentsResolved,
      openCommentsResolvedDetails,
      openCommentsStillOpen: openCommentsStillOpenDetails.length,
      openCommentsStillOpenDetails,
    };
  }

  // Parse previous findings for enrichment — keyed by matchKey for cross-review matching
  const prevFindings = parseFindings(previous.codeReviewJson);
  const prevByKey = new Map(prevFindings.map((f) => [getMatchKey(f), f]));
  const prevKeys = new Set(prevFindings.map((f) => getMatchKey(f)));

  // Build findingId → matchKey map for previous findings (for resolved-comment enrichment)
  const prevIdToKey = new Map(prevFindings.map((f) => [f.id, getMatchKey(f)]));

  // Load resolved posted comments from previous review
  const resolvedComments = await prisma.postedFindingComment.findMany({
    where: { reviewId: previous.id, resolutionStatus: { in: ["RESOLVED", "WONT_FIX"] } },
    select: { findingId: true, resolutionReason: true, resolvedByCommitSha: true, githubHtmlUrl: true },
  });

  // Build resolved summaries enriched with finding metadata
  const resolved: ResolvedFindingSummary[] = [];
  for (const c of resolvedComments) {
    const key = prevIdToKey.get(c.findingId);
    const finding = key ? prevByKey.get(key) : undefined;
    if (!finding) continue;
    resolved.push({
      findingId: c.findingId,
      title: finding.title,
      file: finding.file,
      line: finding.line,
      severity: finding.severity as FindingSeverity,
      reason: (c.resolutionReason ?? "CODE_FIX") as ResolutionReason,
      resolvedByCommitSha: c.resolvedByCommitSha,
      githubHtmlUrl: c.githubHtmlUrl || null,
      sourceReviewId: previous.id,
    });
  }

  // New = in current but not in previous (by content fingerprint)
  const newFindings = currFindings.filter((f) => !prevKeys.has(getMatchKey(f)));
  const newFindingIds = newFindings.map((f) => f.id);

  // Carried over = in both current and previous (by content fingerprint)
  const carriedOverFindings = currFindings.filter((f) => prevKeys.has(getMatchKey(f)));
  const carriedOverIds = carriedOverFindings.map((f) => f.id);

  const carriedOver: CarriedOverFindingSummary[] = carriedOverFindings.map((f) => ({
    findingId: f.id,
    title: f.title,
    file: f.file,
    line: f.line,
    severity: f.severity as FindingSeverity,
  }));

  // Remove open comment entries already represented in the carried-over findings section
  if (carriedOverFindings.length > 0) {
    const carriedOverFps = new Set(carriedOverFindings.map((f) => hashFingerprint(f.file, f.severity, f.title)));
    openCommentsStillOpenDetails = openCommentsStillOpenDetails.filter(
      (d) => !carriedOverFps.has(hashFingerprint(d.file, d.severity, d.title))
    );
  }

  return {
    previousReviewId: previous.id,
    resolved,
    resolvedCount: resolved.length,
    newFindingIds,
    newCount: newFindingIds.length,
    carriedOverIds,
    carriedOver,
    carriedOverCount: carriedOver.length,
    openCommentsResolved,
    openCommentsResolvedDetails,
    openCommentsStillOpen: openCommentsStillOpenDetails.length,
    openCommentsStillOpenDetails,
  };
}
