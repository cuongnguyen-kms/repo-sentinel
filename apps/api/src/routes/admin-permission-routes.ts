/**
 * Admin RBAC: read-only permission catalog route.
 */
import type { FastifyInstance } from "fastify";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";

export async function registerAdminPermissionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/permissions",
    { preHandler: [requireAuth, requirePermission(Resource.Permissions, Action.Read)] },
    async (_request, reply) => {
      const rows = await app.prisma.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }] });
      reply.send({ success: true, data: rows.map((r) => ({ id: r.id, resource: r.resource, action: r.action })) });
    }
  );
}
