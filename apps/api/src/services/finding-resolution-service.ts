/**
 * Auto-resolution of outdated review findings.
 *
 * When a re-review is triggered on new commits, compare the old commit SHA
 * (from the previous review) against the new head commit. For each finding
 * that has a posted GitHub comment, check if the finding's file+line was
 * modified in the diff. If yes, mark the PostedFindingComment as RESOLVED.
 *
 * This is best-effort: errors are caught by the caller and must not block
 * the review trigger flow.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { GheCompareFile } from "@repo-sentinel/ghe-client";
import type { CodeReviewFinding } from "@repo-sentinel/types";

interface HunkRange {
  oldStart: number;
  oldCount: number;
}

/** Parse unified diff hunk headers: @@ -oldStart,oldCount +newStart,newCount @@ */
function parseHunkRanges(patch: string): HunkRange[] {
  const ranges: HunkRange[] = [];
  const regex = /@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(patch)) !== null) {
    ranges.push({
      oldStart: parseInt(match[1]!, 10),
      oldCount: parseInt(match[2] ?? "1", 10),
    });
  }
  return ranges;
}

/** Returns true if the given line falls within any of the changed hunk ranges. */
function isLineInChangedHunks(line: number, hunks: HunkRange[]): boolean {
  return hunks.some((h) => line >= h.oldStart && line < h.oldStart + h.oldCount);
}

/**
 * Resolve outdated findings from a previous review by comparing commits.
 *
 * @param prisma           - Prisma client
 * @param previousReviewId - AiReview.id of the previous completed review
 * @param newCommitSha     - The new head commit SHA (used as resolvedByCommitSha)
 * @param compareFiles     - Files changed between old and new commit (from GheClient.compareCommits)
 * @param log              - Optional logger for diagnostics
 * @returns { resolved, total } — counts for logging/debugging
 */
export async function resolveOutdatedFindings(
  prisma: PrismaClient,
  previousReviewId: string,
  newCommitSha: string,
  compareFiles: GheCompareFile[],
  log?: { info: (msg: string) => void; warn: (msg: string) => void }
): Promise<{ resolved: number; total: number }> {
  const previousReview = await prisma.aiReview.findUnique({
    where: { id: previousReviewId },
    select: { codeReviewJson: true },
  });

  if (!previousReview?.codeReviewJson) {
    return { resolved: 0, total: 0 };
  }

  let findings: CodeReviewFinding[];
  try {
    const parsed = JSON.parse(previousReview.codeReviewJson) as { findings?: CodeReviewFinding[] };
    findings = parsed.findings ?? [];
  } catch {
    return { resolved: 0, total: 0 };
  }

  // Load posted comments for previous review that are still OPEN
  const postedComments = await prisma.postedFindingComment.findMany({
    where: { reviewId: previousReviewId, resolutionStatus: "OPEN" },
    select: { id: true, findingId: true },
  });

  if (postedComments.length === 0) {
    return { resolved: 0, total: findings.length };
  }

  const findingMap = new Map(findings.map((f) => [f.id, f]));

  const fileHunksMap = new Map<string, HunkRange[]>();
  const modifiedFileSet = new Set<string>();
  for (const file of compareFiles) {
    modifiedFileSet.add(file.filename);
    if (file.patch) {
      fileHunksMap.set(file.filename, parseHunkRanges(file.patch));
    }
  }

  const toResolve: string[] = [];
  for (const comment of postedComments) {
    const finding = findingMap.get(comment.findingId);
    if (!finding) continue;

    if (!modifiedFileSet.has(finding.file)) continue;

    const hunks = fileHunksMap.get(finding.file);
    if (!hunks) {
      // File modified but no patch (binary/large file) — resolve conservatively
      toResolve.push(comment.id);
      continue;
    }

    if (isLineInChangedHunks(finding.line, hunks)) {
      toResolve.push(comment.id);
    }
  }

  if (toResolve.length > 0) {
    await prisma.postedFindingComment.updateMany({
      where: { id: { in: toResolve } },
      data: {
        resolutionStatus: "RESOLVED",
        resolutionReason: "CODE_FIX",
        resolvedAt: new Date(),
        resolvedByCommitSha: newCommitSha,
      },
    });
    log?.info(`[auto-resolve] ${toResolve.length}/${postedComments.length} findings resolved`);
  }

  return { resolved: toResolve.length, total: findings.length };
}
