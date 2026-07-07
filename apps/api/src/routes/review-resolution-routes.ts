/**
 * AI review resolution routes — manual resolve, GitHub thread sync, reply sync.
 *
 * PATCH /api/pull-requests/:id/review/findings/:findingId/resolve   — Manually resolve a finding
 * POST  /api/pull-requests/:id/review/resolve-github-threads        — Resolve GitHub review threads
 * POST  /api/pull-requests/:id/review/sync-github-thread-status     — Sync externally resolved threads
 * POST  /api/pull-requests/:id/review/sync-replies                  — Sync replies/dismissals
 * GET   /api/pull-requests/:id/review/resolution-status             — Auto-resolution status per finding
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  reviewPrIdParamSchema,
  resolveFindingParamSchema,
  resolveFindingBodySchema,
  resolveGithubThreadsBodySchema,
  reviewIdQuerySchema,
} from "../schemas/review-schemas.js";
import { resolveGithubThreads, syncGithubThreadStatus } from "../services/github-thread-resolution-service.js";
import { syncRepliesForPr } from "../services/github-reply-sync-service.js";
import { handleZodError } from "./review-route-helpers.js";

export async function registerReviewResolutionRoutes(app: FastifyInstance): Promise<void> {
  // PATCH /api/pull-requests/:id/review/findings/:findingId/resolve — manually resolve a finding
  app.patch(
    "/api/pull-requests/:id/review/findings/:findingId/resolve",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = resolveFindingParamSchema.safeParse(request.params);
      if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }

      const bodyParsed = resolveFindingBodySchema.safeParse(request.body ?? {});
      if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }

      try {
        const { id: prId, findingId } = paramParsed.data;
        const { reason, reviewId: bodyReviewId } = bodyParsed.data;

        let scopedReviewId: string;
        if (bodyReviewId) {
          // Validate the review belongs to this PR to prevent IDOR
          const review = await app.prisma.aiReview.findFirst({
            where: { id: bodyReviewId, pullRequestId: prId },
            select: { id: true },
          });
          if (!review) {
            reply.status(404).send({ success: false, error: "Review not found" });
            return;
          }
          scopedReviewId = bodyReviewId;
        } else {
          const latestReview = await app.prisma.aiReview.findFirst({
            where: { pullRequestId: prId, status: "COMPLETED" },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (!latestReview) {
            reply.status(404).send({ success: false, error: "No completed review found" });
            return;
          }
          scopedReviewId = latestReview.id;
        }

        const resolvedStatus = reason === "WONT_FIX" ? "WONT_FIX" : "RESOLVED";

        // Try updating existing record first (finding was posted to GitHub)
        const updated = await app.prisma.postedFindingComment.updateMany({
          where: { reviewId: scopedReviewId, findingId, resolutionStatus: "OPEN" },
          data: {
            resolutionStatus: resolvedStatus,
            resolutionReason: "MANUAL",
            resolvedAt: new Date(),
          },
        });

        // If no existing record (finding was never posted), create one
        if (updated.count === 0) {
          await app.prisma.postedFindingComment.upsert({
            where: { reviewId_findingId: { reviewId: scopedReviewId, findingId } },
            create: {
              reviewId: scopedReviewId,
              findingId,
              githubCommentId: null,
              githubHtmlUrl: "",
              resolutionStatus: resolvedStatus,
              resolutionReason: "MANUAL",
              resolvedAt: new Date(),
            },
            update: {
              resolutionStatus: resolvedStatus,
              resolutionReason: "MANUAL",
              resolvedAt: new Date(),
            },
          });
        }

        reply.send({ success: true, data: { resolved: 1 } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to resolve finding";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // POST /api/pull-requests/:id/review/resolve-github-threads — resolve GitHub review threads
  app.post(
    "/api/pull-requests/:id/review/resolve-github-threads",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }

      const bodyParsed = resolveGithubThreadsBodySchema.safeParse(request.body);
      if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }

      try {
        const result = await resolveGithubThreads(app.prisma, paramParsed.data.id, bodyParsed.data.findingIds, bodyParsed.data.reviewId);
        reply.send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to resolve GitHub threads";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // POST /api/pull-requests/:id/review/sync-github-thread-status — sync GitHub thread resolved status
  app.post(
    "/api/pull-requests/:id/review/sync-github-thread-status",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }

      const queryParsed = reviewIdQuerySchema.safeParse(request.query);
      if (!queryParsed.success) { handleZodError(queryParsed.error, reply); return; }

      try {
        const result = await syncGithubThreadStatus(app.prisma, parsed.data.id, queryParsed.data.reviewId);
        reply.send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to sync thread status";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // POST /api/pull-requests/:id/review/sync-replies — sync replies/dismissals for recent reviews
  app.post(
    "/api/pull-requests/:id/review/sync-replies",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }

      try {
        const result = await syncRepliesForPr(app.prisma, parsed.data.id, app.log);
        reply.send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to sync replies";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/pull-requests/:id/review/resolution-status — auto-resolution status per finding
  app.get(
    "/api/pull-requests/:id/review/resolution-status",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }

      const queryParsed = reviewIdQuerySchema.safeParse(request.query);
      if (!queryParsed.success) { handleZodError(queryParsed.error, reply); return; }

      try {
        let scopedReviewId: string;
        if (queryParsed.data.reviewId) {
          const review = await app.prisma.aiReview.findFirst({
            where: { id: queryParsed.data.reviewId, pullRequestId: parsed.data.id },
            select: { id: true },
          });
          if (!review) {
            reply.send({ success: true, data: [] });
            return;
          }
          scopedReviewId = queryParsed.data.reviewId;
        } else {
          const latestReview = await app.prisma.aiReview.findFirst({
            where: { pullRequestId: parsed.data.id, status: "COMPLETED" },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (!latestReview) {
            reply.send({ success: true, data: [] });
            return;
          }
          scopedReviewId = latestReview.id;
        }

        const comments = await app.prisma.postedFindingComment.findMany({
          where: { reviewId: scopedReviewId },
          select: {
            findingId: true,
            resolutionStatus: true,
            resolvedByCommitSha: true,
            reviewId: true,
          },
        });

        reply.send({ success: true, data: comments });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch resolution status";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );
}
