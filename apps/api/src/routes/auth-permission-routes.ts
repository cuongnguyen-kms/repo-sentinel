/**
 * Auth permission routes — returns current user's resolved permissions.
 * No requirePermission guard: every authenticated user can read their own permissions.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../middleware/auth-middleware.js";
import { getUserPermissions } from "../services/permission-service.js";

export async function registerAuthPermissionRoutes(app: FastifyInstance) {
  app.get("/api/auth/permissions", { preHandler: [requireAuth] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: userId, role } = request.user;
    const result = await getUserPermissions(userId, role);
    reply.send({ permissions: [...result.permissions] });
  });
}
