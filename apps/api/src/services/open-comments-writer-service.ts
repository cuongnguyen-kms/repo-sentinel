/**
 * Writes findings from previous AI review runs to a JSON file in the cloned
 * repo root before Claude CLI spawns. Claude reads this file during review to
 * evaluate whether each previous finding is still present in the current code.
 *
 * Source: all previous completed AiReview records for the PR, enriched with
 * PostedFindingComment metadata (githubHtmlUrl, commentId) where available.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@repo-sentinel/db";
import type { CodeReviewFinding, CodeReviewResult, OpenCommentEntry } from "@repo-sentinel/types";

export const OPEN_COMMENTS_FILENAME = "manager-hub-open-comments.json";
const MAX_OPEN_COMMENTS = 50;

/**
 * Build a deduplication key for a finding to avoid writing the same issue
 * multiple times when it appears across several reviews (fingerprint first,
 * then fall back to file:line:title).
 */
function findingDedupeKey(f: CodeReviewFinding): string {
  return f.fingerprint ?? `${f.file}:${f.line}:${f.title.toLowerCase().trim()}`;
}

export interface WriteOpenCommentsResult {
  count: number;
  /** Raw JSON string written to disk — saved per-run for auditability/backfill. */
  snapshot: string | null;
}

/**
 * Write findings from previous AI review runs to `manager-hub-open-comments.json`
 * in the cloned repo root. Claude reads this file during review and updates
 * resolution status for each entry.
 *
 * Returns `{ count, snapshot }` — count of entries written and the raw JSON
 * string (for persisting to the AiReview record), or count=0/snapshot=null if skipped.
 */
export async function writeOpenCommentsJson(
  prisma: PrismaClient,
  prId: string,
  repoPath: string,
  log?: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
  }
): Promise<WriteOpenCommentsResult> {
  // 1. Load all previous completed reviews for this PR (most recent first)
  const previousReviews = await prisma.aiReview.findMany({
    where: { pullRequestId: prId, status: "COMPLETED" },
    select: { id: true, codeReviewJson: true },
    orderBy: { createdAt: "desc" },
  });

  if (previousReviews.length === 0) {
    log?.info({}, "[open-comments-writer] no previous reviews for this PR — skipping");
    return { count: 0, snapshot: null };
  }

  // 2. Collect all unique findings across reviews (most recent wins on duplicate key)
  const seen = new Set<string>();
  const collected: Array<{ reviewId: string; finding: CodeReviewFinding }> = [];

  for (const review of previousReviews) {
    if (!review.codeReviewJson) continue;
    let parsed: CodeReviewResult;
    try {
      parsed = JSON.parse(review.codeReviewJson) as CodeReviewResult;
    } catch {
      continue;
    }

    for (const finding of parsed.findings ?? []) {
      const key = findingDedupeKey(finding);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push({ reviewId: review.id, finding });
      if (collected.length >= MAX_OPEN_COMMENTS) break;
    }
    if (collected.length >= MAX_OPEN_COMMENTS) break;
  }

  if (collected.length === 0) {
    log?.info({}, "[open-comments-writer] no findings in previous reviews — skipping");
    return { count: 0, snapshot: null };
  }

  // 3. Enrich with PostedFindingComment metadata (githubHtmlUrl, commentId) where available
  const reviewIds = [...new Set(collected.map((c) => c.reviewId))];
  const postedComments = await prisma.postedFindingComment.findMany({
    where: { reviewId: { in: reviewIds } }, // include RESOLVED — needed for exclusion
    select: { id: true, findingId: true, reviewId: true, githubHtmlUrl: true, resolutionStatus: true },
  });

  // Exclude only RESOLVED findings — they need no further tracking
  const resolvedKeys = new Set(
    postedComments.filter((c) => c.resolutionStatus === "RESOLVED").map((c) => `${c.reviewId}:${c.findingId}`)
  );

  // WONT_FIX findings are written to the file so Claude knows not to re-report them
  const wontFixKeys = new Set(
    postedComments.filter((c) => c.resolutionStatus === "WONT_FIX").map((c) => `${c.reviewId}:${c.findingId}`)
  );

  // URL-enrichment map — only OPEN GitHub-posted comments
  const postedMap = new Map(
    postedComments
      .filter((c) => c.resolutionStatus === "OPEN" && c.githubHtmlUrl)
      .map((c) => [`${c.reviewId}:${c.findingId}`, c])
  );

  // 4. Build entries, excluding only RESOLVED findings.
  //    WONT_FIX findings are included with status "WONT_FIX" so Claude skips re-reporting them.
  const entries: OpenCommentEntry[] = collected
    .filter(({ reviewId, finding }) => !resolvedKeys.has(`${reviewId}:${finding.id}`))
    .map(({ reviewId, finding }) => {
      const isWontFix = wontFixKeys.has(`${reviewId}:${finding.id}`);
      const posted = isWontFix ? undefined : postedMap.get(`${reviewId}:${finding.id}`);
      return {
        // commentId is PostedFindingComment.id if posted, else synthetic reviewId:findingId
        commentId: posted?.id ?? `${reviewId}:${finding.id}`,
        findingId: finding.id,
        title: finding.title,
        file: finding.file,
        line: finding.line,
        severity: finding.severity,
        comment: finding.comment,
        githubHtmlUrl: posted?.githubHtmlUrl ?? "",
        status: isWontFix ? "WONT_FIX" as const : "OPEN" as const,
        resolution: null,
        resolutionReason: null,
      };
    });

  // 5. Write to repo root
  const snapshot = JSON.stringify(entries, null, 2);
  const filePath = join(repoPath, OPEN_COMMENTS_FILENAME);
  try {
    await writeFile(filePath, snapshot, "utf-8");
    log?.info({ count: entries.length }, "[open-comments-writer] wrote previous findings for resolution check");
  } catch (err) {
    log?.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "[open-comments-writer] failed to write manager-hub-open-comments.json — continuing without"
    );
    return { count: 0, snapshot: null };
  }

  return { count: entries.length, snapshot };
}
