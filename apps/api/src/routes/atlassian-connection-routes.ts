/**
 * Atlassian connection management routes — singleton (not list-based).
 *
 * GET    /api/atlassian/connection             — get the connection (no token) or null
 * PUT    /api/atlassian/connection             — create-or-replace the singleton
 * DELETE /api/atlassian/connection             — remove it
 * POST   /api/atlassian/connection/test        — live credential test
 * POST   /api/atlassian/connection/test-ticket — fetch one ticket to verify end-to-end access
 *
 * API tokens are NEVER returned in any response.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { replaceAtlassianConnectionSchema, testTicketBodySchema } from "../schemas/atlassian-schemas.js";
import {
  getConnection,
  replaceConnection,
  deleteConnection,
  testConnection,
  getDecryptedConnection,
} from "../services/atlassian-connection-service.js";
import { fetchJiraTicket } from "../services/jira-ticket-service.js";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({
    success: false,
    error: "Validation failed",
    details: err.flatten().fieldErrors,
  });
}

export async function registerAtlassianConnectionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/atlassian/connection
  app.get(
    "/api/atlassian/connection",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await getConnection(app.prisma);
        reply.send({ success: true, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch connection";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // PUT /api/atlassian/connection
  app.put(
    "/api/atlassian/connection",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = replaceAtlassianConnectionSchema.safeParse(request.body);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const dto = await replaceConnection(app.prisma, parsed.data);
        reply.send({ success: true, data: dto });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save connection";
        reply.status(422).send({ success: false, error: message });
      }
    }
  );

  // DELETE /api/atlassian/connection
  app.delete(
    "/api/atlassian/connection",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Delete)] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        await deleteConnection(app.prisma);
        reply.status(204).send();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete connection";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // POST /api/atlassian/connection/test
  app.post(
    "/api/atlassian/connection/test",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await testConnection(app.prisma);
        const status = result.success ? 200 : 422;
        reply.status(status).send({ success: result.success, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Test failed";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // POST /api/atlassian/connection/test-ticket
  app.post(
    "/api/atlassian/connection/test-ticket",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = testTicketBodySchema.safeParse(request.body);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      const conn = await getDecryptedConnection(app.prisma);
      if (!conn) {
        reply.status(400).send({ success: false, error: "No Atlassian connection configured" });
        return;
      }

      try {
        const ticket = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, parsed.data.ticketKey.toUpperCase());
        reply.send({ success: true, data: ticket });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Ticket fetch failed";
        reply.status(422).send({ success: false, error: message });
      }
    }
  );
}
