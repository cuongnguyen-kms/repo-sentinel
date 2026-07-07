/**
 * AI review routes.
 *
 * POST  /api/pull-requests/:id/review          — Trigger a new AI review
 * GET   /api/pull-requests/:id/review          — Get the latest AiReview for a PR
 * GET   /api/pull-requests/:id/reviews         — Get paginated review history for a PR
 * GET   /api/reviews/:id                       — Get a single review by ID
 * GET   /api/reviews/:id/terminal-log          — Full terminal output for a review
 * GET   /api/reviews/:id/output-buffer         — Buffered CLI output chunks (live replay)
 * POST  /api/reviews/:id/cancel                — Cancel a queued/running review
 * DELETE /api/reviews/:id                      — Delete a completed/failed/cancelled review
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  reviewPrIdParamSchema,
  reviewIdParamSchema,
  reviewHistoryQuerySchema,
} from "../schemas/review-schemas.js";
import { triggerReview, cancelReview, deleteReview } from "../services/ai-review-service.js";
import { getOutputBuffer } from "../services/claude-cli-service.js";
import { computeReviewComparison } from "../services/review-comparison-service.js";
import { handleZodError, enrichReviewDto, ServiceError, type AiReviewWithCount } from "./review-route-helpers.js";

export async function registerReviewRoutes(
  app: FastifyInstance
): Promise<void> {
  // POST /api/pull-requests/:id/review — trigger AI review
  app.post(
    "/api/pull-requests/:id/review",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const result = await triggerReview(app.prisma, parsed.data.id, app.io, request.log);
        reply.status(202).send({ success: true, data: result });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to trigger review";
        const status = err instanceof ServiceError
          ? err.statusCode
          : message.includes("not found") ? 404 : 400;
        reply.status(status).send({ success: false, error: message });
      }
    }
  );

  // GET /api/pull-requests/:id/review — latest review (enriched with commitSha + counts)
  app.get(
    "/api/pull-requests/:id/review",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const review = await app.prisma.aiReview.findFirst({
          where: { pullRequestId: parsed.data.id },
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { postedComments: true } } },
        });
        if (!review) {
          reply.status(404).send({ success: false, error: "No review found for this PR" });
          return;
        }
        reply.send({ success: true, data: enrichReviewDto(review) });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch review";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/pull-requests/:id/reviews — paginated review history with enriched DTOs
  app.get(
    "/api/pull-requests/:id/reviews",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }

      const queryParsed = reviewHistoryQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        handleZodError(queryParsed.error, reply);
        return;
      }

      const { limit, offset } = queryParsed.data;
      const prId = paramParsed.data.id;

      try {
        const pr = await app.prisma.pullRequest.findUnique({
          where: { id: prId },
          select: { id: true },
        });
        if (!pr) {
          reply.status(404).send({ success: false, error: "Pull request not found" });
          return;
        }

        const [reviews, total] = await Promise.all([
          app.prisma.aiReview.findMany({
            where: { pullRequestId: prId },
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: limit,
            select: {
              id: true,
              pullRequestId: true,
              commitSha: true,
              status: true,
              reviewPhase: true,
              summary: true,
              score: true,
              startedAt: true,
              completedAt: true,
              errorMessage: true,
              createdAt: true,
              findingsCount: true,
              codeReviewJson: true,
              _count: { select: { postedComments: true } },
            },
          }),
          app.prisma.aiReview.count({ where: { pullRequestId: prId } }),
        ]);

        const enriched = reviews.map((r) => {
          const dto = enrichReviewDto(r as AiReviewWithCount);
          // Strip heavy blob from summary list — breakdown is already extracted
          const { codeReviewJson: _, ...summary } = dto;
          return summary;
        });

        reply.send({
          success: true,
          data: enriched,
          total,
          limit,
          offset,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch review history";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/reviews/:id — single review detail
  app.get(
    "/api/reviews/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const review = await app.prisma.aiReview.findUnique({
          where: { id: parsed.data.id },
          include: { _count: { select: { postedComments: true } } },
        });
        if (!review) {
          reply.status(404).send({ success: false, error: "Review not found" });
          return;
        }
        reply.send({ success: true, data: enrichReviewDto(review) });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch review";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/reviews/:id/comparison — run-over-run comparison summary
  app.get(
    "/api/reviews/:id/comparison",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewIdParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }

      try {
        const data = await computeReviewComparison(app.prisma, parsed.data.id);
        reply.send({ success: true, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to compute review comparison";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/reviews/:id/terminal-log — full terminal output from the review session
  app.get(
    "/api/reviews/:id/terminal-log",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewIdParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }

      const review = await app.prisma.aiReview.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, terminalLog: true, status: true, pullRequestId: true },
      });
      if (!review) { reply.status(404).send({ success: false, error: "Review not found" }); return; }

      reply.send({ success: true, data: { id: review.id, terminalLog: review.terminalLog } });
    }
  );

  // GET /api/reviews/:id/output-buffer — buffered CLI output chunks for terminal replay
  app.get(
    "/api/reviews/:id/output-buffer",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      const chunks = getOutputBuffer(`review:${parsed.data.id}`);
      reply.send({ success: true, data: { chunks } });
    }
  );

  // POST /api/reviews/:id/cancel — cancel a queued or running review
  app.post(
    "/api/reviews/:id/cancel",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const result = await cancelReview(app.prisma, parsed.data.id, app.io, request.log);
        reply.send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to cancel review";
        const status = err instanceof ServiceError ? err.statusCode : 500;
        reply.status(status).send({ success: false, error: message });
      }
    }
  );

  // DELETE /api/reviews/:id — permanently delete a completed/failed/cancelled review
  app.delete(
    "/api/reviews/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Reviews, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const result = await deleteReview(app.prisma, parsed.data.id, app.io, request.log);
        reply.send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete review";
        const status = err instanceof ServiceError ? err.statusCode : 500;
        reply.status(status).send({ success: false, error: message });
      }
    }
  );
}
