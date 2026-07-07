/**
 * AI review comment routes — GitHub comment operations.
 *
 * POST   /api/pull-requests/:id/review/comments             — Post single finding to GitHub
 * POST   /api/pull-requests/:id/review/submit                — Batch submit selected findings
 * GET    /api/pull-requests/:id/review/posted-comments        — List posted finding comments
 * GET    /api/pull-requests/:id/review/comments/:findingId/verify — Verify comment still exists
 * DELETE /api/pull-requests/:id/review/comments/:findingId    — Delete comment from GitHub
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  reviewPrIdParamSchema,
  postCommentBodySchema,
  submitReviewBodySchema,
  resolveFindingParamSchema,
  reviewIdQuerySchema,
} from "../schemas/review-schemas.js";
import {
  postSingleComment,
  submitBatchReview,
  listPostedComments,
  verifyFindingComment,
  deleteFindingComment,
} from "../services/github-comment-service.js";
import { handleZodError, ServiceError } from "./review-route-helpers.js";

export async function registerReviewCommentRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/pull-requests/:id/review/comments — post single finding to GitHub
  app.post(
    "/api/pull-requests/:id/review/comments",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }

      const bodyParsed = postCommentBodySchema.safeParse(request.body);
      if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }

      try {
        const result = await postSingleComment(app.prisma, paramParsed.data.id, bodyParsed.data);
        reply.send({ success: true, data: result });
      } catch (err) {
        const status = err instanceof ServiceError ? err.statusCode : 500;
        const message = err instanceof Error ? err.message : "Failed to post comment";
        reply.status(status).send({ success: false, error: message });
      }
    }
  );

  // POST /api/pull-requests/:id/review/submit — batch submit selected findings
  app.post(
    "/api/pull-requests/:id/review/submit",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }

      const bodyParsed = submitReviewBodySchema.safeParse(request.body);
      if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }

      try {
        const result = await submitBatchReview(app.prisma, paramParsed.data.id, bodyParsed.data, app.log);
        reply.send({ success: true, data: result });
      } catch (err) {
        const status = err instanceof ServiceError ? err.statusCode : 500;
        const message = err instanceof Error ? err.message : "Failed to submit review";
        reply.status(status).send({ success: false, error: message });
      }
    }
  );

  // GET /api/pull-requests/:id/review/posted-comments — list findings posted to GitHub
  app.get(
    "/api/pull-requests/:id/review/posted-comments",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = reviewPrIdParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }

      const queryParsed = reviewIdQuerySchema.safeParse(request.query);
      if (!queryParsed.success) { handleZodError(queryParsed.error, reply); return; }

      try {
        const comments = await listPostedComments(app.prisma, parsed.data.id, queryParsed.data.reviewId);
        reply.send({ success: true, data: comments });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to list posted comments";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/pull-requests/:id/review/comments/:findingId/verify — check if GitHub comment still exists
  app.get(
    "/api/pull-requests/:id/review/comments/:findingId/verify",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = resolveFindingParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      const queryParsed = reviewIdQuerySchema.safeParse(request.query);
      if (!queryParsed.success) { handleZodError(queryParsed.error, reply); return; }

      try {
        const result = await verifyFindingComment(app.prisma, parsed.data.id, parsed.data.findingId, queryParsed.data.reviewId);
        reply.send({ success: true, data: result });
      } catch (err) {
        const status = err instanceof ServiceError ? err.statusCode : 500;
        const message = err instanceof Error ? err.message : "Failed to verify comment";
        reply.status(status).send({ success: false, error: message });
      }
    }
  );

  // DELETE /api/pull-requests/:id/review/comments/:findingId — delete comment from GitHub
  app.delete(
    "/api/pull-requests/:id/review/comments/:findingId",
    { preHandler: [requireAuth, requirePermission(Resource.Findings, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = resolveFindingParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      const queryParsed = reviewIdQuerySchema.safeParse(request.query);
      if (!queryParsed.success) { handleZodError(queryParsed.error, reply); return; }

      try {
        const result = await deleteFindingComment(
          app.prisma, parsed.data.id, parsed.data.findingId, queryParsed.data.reviewId
        );
        reply.send({ success: true, data: result });
      } catch (err) {
        const status = err instanceof ServiceError ? err.statusCode : 500;
        const message = err instanceof Error ? err.message : "Failed to delete comment";
        reply.status(status).send({ success: false, error: message });
      }
    }
  );
}
