/**
 * Repository management routes.
 *
 * GET    /api/connections/:connId/repos  — Browse GHE repos (paginated, searchable)
 * POST   /api/repos/watch               — Watch one or more repos
 * DELETE /api/repos/watch/:id           — Unwatch a repo
 * GET    /api/repos                     — List watched repos with open-PR counts
 * PATCH  /api/repos/:id                 — Update polling config (interval, isActive)
 * POST   /api/repos/:id/poll            — Trigger an immediate poll
 *
 * Tokens are NEVER returned in any response.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  watchReposSchema,
  updateRepoSchema,
  browseReposQuerySchema,
  repoIdParamSchema,
  connIdParamSchema,
  triggerPollSchema,
} from "../schemas/repo-schemas.js";
import {
  browseGheRepos,
  watchRepos,
  unwatchRepo,
  listWatchedRepos,
  updateRepoConfig,
} from "../services/repo-service.js";
import { pollingQueue } from "../queues/repo-polling-queue.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({
    success: false,
    error: "Validation failed",
    details: err.flatten().fieldErrors,
  });
}

export async function registerReposRoutes(
  app: FastifyInstance
): Promise<void> {
  // GET /api/connections/:connId/repos
  app.get(
    "/api/connections/:connId/repos",
    { preHandler: [requireAuth, requirePermission(Resource.Repos, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = connIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      const queryParsed = browseReposQuerySchema.safeParse(request.query);
      if (!queryParsed.success) {
        handleZodError(queryParsed.error, reply);
        return;
      }

      try {
        const result = await browseGheRepos(
          app.prisma,
          paramParsed.data.connId,
          queryParsed.data.page,
          queryParsed.data.search
        );
        reply.send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to browse repos";
        reply.status(422).send({ success: false, error: message });
      }
    }
  );

  // POST /api/repos/watch
  app.post(
    "/api/repos/watch",
    { preHandler: [requireAuth, requirePermission(Resource.Repos, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = watchReposSchema.safeParse(request.body);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const result = await watchRepos(app.prisma, parsed.data);
        reply.status(201).send({ success: true, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to watch repos";
        reply.status(422).send({ success: false, error: message });
      }
    }
  );

  // DELETE /api/repos/watch/:id
  app.delete(
    "/api/repos/watch/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Repos, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = repoIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        await unwatchRepo(app.prisma, parsed.data.id);
        reply.status(204).send();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to unwatch repo";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // GET /api/repos
  app.get(
    "/api/repos",
    { preHandler: [requireAuth, requirePermission(Resource.Repos, Action.Read)] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const repos = await listWatchedRepos(app.prisma);
        reply.send({ success: true, data: repos });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to list repos";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // PATCH /api/repos/:id
  app.patch(
    "/api/repos/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Repos, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = repoIdParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      const bodyParsed = updateRepoSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }

      try {
        const updated = await updateRepoConfig(
          app.prisma,
          paramParsed.data.id,
          bodyParsed.data
        );
        reply.send({ success: true, data: updated });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update repo";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // POST /api/repos/:id/poll  — trigger immediate poll
  app.post(
    "/api/repos/:id/poll",
    { preHandler: [requireAuth, requirePermission(Resource.Repos, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = repoIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      const bodyParsed = triggerPollSchema.safeParse(request.body ?? {});
      const force = bodyParsed.success && bodyParsed.data.force;

      try {
        // Clear ETag so the next poll does a full sync instead of 304 Not Modified
        if (force) {
          await app.prisma.watchedRepo.update({
            where: { id: parsed.data.id },
            data: { etag: null },
          });
        }

        // Use the same deterministic jobId as the scheduler so a manual poll
        // is naturally deduplicated if one is already waiting/active for this repo.
        await pollingQueue.add(
          "poll-repo",
          { repoId: parsed.data.id },
          {
            jobId: `poll-${parsed.data.id}`,
            attempts: 1,
            removeOnComplete: { count: 0 },
            removeOnFail: { count: 0 },
          }
        );
        reply.status(202).send({ success: true, data: { queued: true } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to queue poll";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );
}
