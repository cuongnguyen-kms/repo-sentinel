/**
 * Pull request routes.
 *
 * GET /api/pull-requests        — List PRs with filters, sorting, pagination
 * GET /api/pull-requests/:id    — PR detail with AI review
 * GET /api/dashboard/stats      — Aggregate counts for dashboard summary cards
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  listPullRequestsQuerySchema,
  prIdParamSchema,
} from "../schemas/pull-request-schemas.js";
import {
  listPullRequests,
  getPullRequestDetail,
  getDashboardStats,
} from "../services/pull-request-service.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({
    success: false,
    error: "Validation failed",
    details: err.flatten().fieldErrors,
  });
}

export async function registerPullRequestRoutes(
  app: FastifyInstance
): Promise<void> {
  // GET /api/pull-requests
  app.get(
    "/api/pull-requests",
    { preHandler: [requireAuth, requirePermission(Resource.PullRequests, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listPullRequestsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const { pullRequests, total } = await listPullRequests(
          app.prisma,
          parsed.data
        );
        const { page, limit } = parsed.data;
        reply.send({
          success: true,
          data: pullRequests,
          total,
          page,
          perPage: limit,
          totalPages: Math.ceil(total / limit),
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to list pull requests";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/pull-requests/:id
  app.get(
    "/api/pull-requests/:id",
    { preHandler: [requireAuth, requirePermission(Resource.PullRequests, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = prIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const pr = await getPullRequestDetail(app.prisma, parsed.data.id);
        if (!pr) {
          reply.status(404).send({ success: false, error: "Pull request not found" });
          return;
        }
        reply.send({ success: true, data: pr });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch pull request";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/dashboard/stats
  app.get(
    "/api/dashboard/stats",
    { preHandler: [requireAuth, requirePermission(Resource.Dashboard, Action.Read)] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await getDashboardStats(app.prisma);
        reply.send({ success: true, data: stats });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to fetch dashboard stats";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );
}
