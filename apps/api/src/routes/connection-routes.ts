/**
 * Connection management routes.
 *
 * POST   /api/connections          — create a new GHE connection
 * GET    /api/connections          — list all connections (no tokens)
 * DELETE /api/connections/:id      — delete a connection
 * POST   /api/connections/:id/test — test a stored connection live
 *
 * Tokens are NEVER returned in any response.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import {
  createConnectionSchema,
  connectionIdParamSchema,
} from "../schemas/connection-schemas.js";
import {
  createConnection,
  listConnections,
  deleteConnection,
  testConnection,
} from "../services/connection-service.js";
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

export async function registerConnectionRoutes(
  app: FastifyInstance
): Promise<void> {
  // POST /api/connections
  app.post(
    "/api/connections",
    { preHandler: [requireAuth, requirePermission(Resource.Connections, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createConnectionSchema.safeParse(request.body);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const dto = await createConnection(app.prisma, parsed.data);
        reply.status(201).send({ success: true, data: dto });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create connection";
        reply.status(422).send({ success: false, error: message });
      }
    }
  );

  // GET /api/connections
  app.get("/api/connections", { preHandler: [requireAuth, requirePermission(Resource.Connections, Action.Read)] }, async (_request, reply: FastifyReply) => {
    try {
      const connections = await listConnections(app.prisma);
      reply.send({ success: true, data: connections });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list connections";
      reply.status(500).send({ success: false, error: message });
    }
  });

  // DELETE /api/connections/:id
  app.delete(
    "/api/connections/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Connections, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = connectionIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        await deleteConnection(app.prisma, parsed.data.id);
        reply.status(204).send();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete connection";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // POST /api/connections/:id/test
  app.post(
    "/api/connections/:id/test",
    { preHandler: [requireAuth, requirePermission(Resource.Connections, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = connectionIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const result = await testConnection(app.prisma, parsed.data.id);
        const status = result.success ? 200 : 422;
        reply.status(status).send({ success: result.success, data: result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Test failed";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );
}
