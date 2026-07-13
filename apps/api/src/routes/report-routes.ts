/**
 * Report routes — Merged PR Comment Tracking Report.
 * Provides aggregated comment statistics for merged PRs grouped by sprint.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import { syncRepliesForPr } from "../services/github-reply-sync-service.js";
import { syncGithubThreadStatus } from "../services/github-thread-resolution-service.js";

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

interface CommentRow {
  resolutionStatus: string | null;
  resolutionReason: string | null;
  dismissalKeyword: string | null;
  replyCount: number;
  lastReplyBody: string | null;
  githubThreadResolved: boolean;
}

/** Effective status: if GitHub thread is resolved, treat as RESOLVED regardless of DB status */
function effectiveStatus(c: CommentRow): string {
  if (c.githubThreadResolved && c.resolutionStatus === "OPEN") return "RESOLVED";
  return c.resolutionStatus ?? "OPEN";
}

function classifyComment(c: CommentRow): string {
  const status = effectiveStatus(c);
  if (status === "OPEN") return "OPEN";

  if (status === "WONT_FIX") {
    const kw = (c.dismissalKeyword ?? "").toLowerCase();
    if (kw.includes("invalid") || kw.includes("false positive")) return "INVALID_COMMENT";
    if (kw.includes("not fix") || kw.includes("won't fix") || kw.includes("wont fix")) return "NOT_FIX_NOW";
    if (kw.includes("by design") || kw.includes("intentional")) return "BY_DESIGN";
    if (kw.includes("accepted risk")) return "ACCEPTED_RISK";
    return "OTHER_DISMISSED";
  }

  if (status === "RESOLVED") {
    // Auto-resolved comments don't need a reply — classify by reason, not reply count
    if (c.resolutionReason === "NO_LONGER_FLAGGED" || c.resolutionReason === "SUPERSEDED" || c.resolutionReason === "LINE_NOT_IN_DIFF") {
      return "NO_LONGER_FLAGGED";
    }
    if (c.resolutionReason === "CODE_FIX") return "FIXED_CODE";
    if (c.resolutionReason === "MANUAL") return "OTHER_DISMISSED";
    // Thread resolved on GitHub = developer explicitly resolved it (not "no reply")
    if (c.githubThreadResolved) return "FIXED_CODE";
    if (c.replyCount === 0 && !c.resolutionReason) return "NO_REPLY";
    const reply = (c.lastReplyBody ?? "").toLowerCase();
    if (/\b(fixed|done|applied|resolved|merged|addressed)\b/.test(reply)) return "FIXED_CODE";
    return "OTHER_RESOLVED";
  }

  return "OTHER_RESOLVED";
}

const EMPTY_COUNTS = {
  open: 0, fixedCode: 0, noLongerFlagged: 0, invalidComment: 0,
  notFixNow: 0, byDesign: 0, acceptedRisk: 0, noReply: 0,
  otherResolved: 0, otherDismissed: 0, total: 0,
};

const CATEGORY_KEY_MAP: Record<string, keyof typeof EMPTY_COUNTS> = {
  OPEN: "open", FIXED_CODE: "fixedCode", NO_LONGER_FLAGGED: "noLongerFlagged",
  INVALID_COMMENT: "invalidComment", NOT_FIX_NOW: "notFixNow", BY_DESIGN: "byDesign",
  ACCEPTED_RISK: "acceptedRisk", NO_REPLY: "noReply",
  OTHER_RESOLVED: "otherResolved", OTHER_DISMISSED: "otherDismissed",
};

// ---------------------------------------------------------------------------
// Sprint helpers
// ---------------------------------------------------------------------------

interface Sprint {
  label: string;
  start: Date;
  end: Date;
}

function generateSprints(startDateStr: string, lengthDays: number, count: number): Sprint[] {
  const start = new Date(startDateStr);
  const now = new Date();
  const msPerDay = 86_400_000;
  const sprintMs = lengthDays * msPerDay;

  // Find the sprint that contains "now"
  const elapsed = now.getTime() - start.getTime();
  const currentIdx = Math.floor(elapsed / sprintMs);

  const sprints: Sprint[] = [];
  for (let i = 0; i < count; i++) {
    const idx = currentIdx - i;
    if (idx < 0) break;
    const s = new Date(start.getTime() + idx * sprintMs);
    const e = new Date(s.getTime() + sprintMs);
    sprints.push({
      label: `${s.toISOString().substring(0, 10)} to ${e.toISOString().substring(0, 10)}${i === 0 ? " (current)" : ""}`,
      start: s,
      end: e,
    });
  }
  return sprints;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/report/sprints — list available sprints
  app.get(
    "/api/report/sprints",
    { preHandler: [requireAuth, requirePermission(Resource.PrComments, Action.Read)] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const [startSetting, lengthSetting] = await app.prisma.$transaction([
        app.prisma.appSetting.findUnique({ where: { key: "report.sprintStartDate" } }),
        app.prisma.appSetting.findUnique({ where: { key: "report.sprintLengthDays" } }),
      ]);
      const startDate = startSetting?.value || "2026-01-05";
      const lengthDays = parseInt(lengthSetting?.value || "14", 10);
      const sprints = generateSprints(startDate, lengthDays, 12);

      reply.send({
        success: true,
        data: sprints.map((s) => ({
          label: s.label,
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })),
      });
    }
  );

  // GET /api/report/merged-pr-comments — main report data
  app.get(
    "/api/report/merged-pr-comments",
    { preHandler: [requireAuth, requirePermission(Resource.PrComments, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as Record<string, string | undefined>;
      const sprintStart = q["sprintStart"] ? new Date(q["sprintStart"]) : null;
      const sprintEnd = q["sprintEnd"] ? new Date(q["sprintEnd"]) : null;
      const repoId = q["repoId"];

      const prWhere: Record<string, unknown> = { state: "MERGED" };
      if (sprintStart && sprintEnd) {
        prWhere["mergedAt"] = { gte: sprintStart, lt: sprintEnd };
      }
      if (repoId) prWhere["repoId"] = repoId;

      const mergedPrs = await app.prisma.pullRequest.findMany({
        where: prWhere,
        orderBy: { mergedAt: "desc" },
        select: {
          id: true, ghePrId: true, title: true, htmlUrl: true,
          authorLogin: true, mergedAt: true,
          repo: { select: { fullName: true } },
        },
      });

      if (mergedPrs.length === 0) {
        reply.send({
          success: true,
          data: { summary: { ...EMPTY_COUNTS, totalMergedPrs: 0 }, prs: [] },
        });
        return;
      }

      const prIds = mergedPrs.map((p) => p.id);

      // Sync reply + thread resolution state for PRs with OPEN comments before
      // building the report, so GitHub-side resolutions are reflected.
      const prsWithOpenComments = await app.prisma.postedFindingComment.findMany({
        where: {
          review: { pullRequestId: { in: prIds } },
          githubHtmlUrl: { not: "" },
          resolutionStatus: "OPEN",
        },
        select: { review: { select: { pullRequestId: true } } },
        distinct: ["reviewId"],
      });
      const openPrIds = [...new Set(prsWithOpenComments.map((c) => c.review?.pullRequestId).filter(Boolean))] as string[];
      if (openPrIds.length > 0) {
        await Promise.allSettled(
          openPrIds.slice(0, 5).map(async (prId) => {
            await syncRepliesForPr(app.prisma, prId);
            await syncGithubThreadStatus(app.prisma, prId).catch((err) => {
              app.log.warn({ err, prId }, "[report] thread resolution sync failed — non-blocking");
            });
          })
        );
      }

      const comments = await app.prisma.postedFindingComment.findMany({
        where: {
          review: { pullRequestId: { in: prIds } },
          githubHtmlUrl: { not: "" },
        },
        select: {
          id: true, findingId: true, reviewId: true,
          resolutionStatus: true, resolutionReason: true,
          dismissalKeyword: true, replyCount: true, lastReplyBody: true,
          githubHtmlUrl: true, githubThreadResolved: true,
          review: { select: { pullRequestId: true, codeReviewJson: true } },
        },
      });

      // Build finding details lookup (title, severity, file, line from codeReviewJson)
      const findingDetails = new Map<string, { title: string; severity: string; file: string; line: number }>();
      const parsedJsonCache = new Map<string, Array<{ id: string; title: string; severity: string; file: string; line: number }>>();
      for (const c of comments) {
        if (!c.review?.codeReviewJson) continue;
        const reviewId = c.reviewId;
        if (!parsedJsonCache.has(reviewId)) {
          try {
            const parsed = JSON.parse(c.review.codeReviewJson) as { findings?: Array<{ id: string; title: string; severity: string; file: string; line: number }> };
            parsedJsonCache.set(reviewId, parsed.findings ?? []);
          } catch { parsedJsonCache.set(reviewId, []); }
        }
        const findings = parsedJsonCache.get(reviewId)!;
        const f = findings.find((f) => f.id === c.findingId);
        if (f) findingDetails.set(c.id, { title: f.title, severity: f.severity, file: f.file, line: f.line });
      }

      // Group comments by PR and classify
      const prCommentMap = new Map<string, Array<typeof comments[0] & { category: string }>>();
      for (const c of comments) {
        const prId = c.review?.pullRequestId;
        if (!prId) continue;
        const category = classifyComment(c);
        if (!prCommentMap.has(prId)) prCommentMap.set(prId, []);
        prCommentMap.get(prId)!.push({ ...c, category });
      }

      const summary = { ...EMPTY_COUNTS, totalMergedPrs: mergedPrs.length };
      const prResults = mergedPrs.map((pr) => {
        const prComments = prCommentMap.get(pr.id) ?? [];
        const counts = { ...EMPTY_COUNTS };
        counts.total = prComments.length;

        const commentDtos = prComments.map((c) => {
          const key = CATEGORY_KEY_MAP[c.category];
          if (key && key !== "total") counts[key]++;
          const details = findingDetails.get(c.id);
          return {
            id: c.id,
            findingTitle: details?.title ?? c.findingId,
            findingSeverity: details?.severity ?? "",
            findingFile: details?.file ?? "",
            findingLine: details?.line ?? 0,
            resolutionStatus: effectiveStatus(c),
            resolutionReason: c.resolutionReason,
            category: c.category,
            replyCount: c.replyCount,
            lastReplyBody: c.lastReplyBody?.substring(0, 200) ?? null,
            dismissalKeyword: c.dismissalKeyword,
            githubHtmlUrl: c.githubHtmlUrl,
          };
        });

        for (const key of Object.keys(EMPTY_COUNTS) as Array<keyof typeof EMPTY_COUNTS>) {
          if (key !== "total") (summary as Record<string, number>)[key] += counts[key];
        }
        summary.total += counts.total;

        return {
          prId: pr.id,
          prNumber: pr.ghePrId,
          prTitle: pr.title,
          prUrl: pr.htmlUrl,
          authorLogin: pr.authorLogin,
          repoFullName: pr.repo.fullName,
          mergedAt: pr.mergedAt?.toISOString() ?? null,
          counts,
          comments: commentDtos,
        };
      });

      // Latest merged PR first; tie-break by open comments descending
      prResults.sort((a, b) => {
        const dateA = a.mergedAt ? new Date(a.mergedAt).getTime() : 0;
        const dateB = b.mergedAt ? new Date(b.mergedAt).getTime() : 0;
        if (dateB !== dateA) return dateB - dateA;
        return b.counts.open - a.counts.open;
      });

      reply.send({ success: true, data: { summary, prs: prResults } });
    }
  );
}
