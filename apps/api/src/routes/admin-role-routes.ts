/**
 * Admin RBAC: role management routes.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  createRoleSchema,
  updateRoleSchema,
  roleIdParamSchema,
  setRolePermissionsBodySchema,
  deleteQuerySchema,
} from "../schemas/admin-schemas.js";
import { listRoles, createRole, updateRole, deleteRole, setRolePermissions } from "../services/role-service.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({ success: false, error: "Validation failed", details: err.flatten().fieldErrors });
}

export async function registerAdminRoleRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/roles",
    { preHandler: [requireAuth, requirePermission(Resource.Roles, Action.Read)] },
    async (_request, reply: FastifyReply) => {
      reply.send({ success: true, data: await listRoles(app.prisma) });
    }
  );

  app.post(
    "/api/admin/roles",
    { preHandler: [requireAuth, requirePermission(Resource.Roles, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      try {
        const dto = await createRole(app.prisma, parsed.data);
        reply.status(201).send({ success: true, data: dto });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Failed to create role" });
      }
    }
  );

  app.patch(
    "/api/admin/roles/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Roles, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = roleIdParamSchema.safeParse(request.params);
      const bodyParsed = updateRoleSchema.safeParse(request.body);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }
      try {
        await updateRole(app.prisma, paramParsed.data.id, bodyParsed.data);
        reply.send({ success: true });
      } catch (err) {
        reply.status(409).send({ success: false, error: err instanceof Error ? err.message : "Failed to update role" });
      }
    }
  );

  app.delete(
    "/api/admin/roles/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Roles, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = roleIdParamSchema.safeParse(request.params);
      const queryParsed = deleteQuerySchema.safeParse(request.query);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!queryParsed.success) {
        handleZodError(queryParsed.error, reply);
        return;
      }
      try {
        await deleteRole(app.prisma, paramParsed.data.id, queryParsed.data.force);
        reply.status(204).send();
      } catch (err) {
        reply.status(409).send({ success: false, error: err instanceof Error ? err.message : "Failed to delete role" });
      }
    }
  );

  app.put(
    "/api/admin/roles/:id/permissions",
    { preHandler: [requireAuth, requirePermission(Resource.Roles, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = roleIdParamSchema.safeParse(request.params);
      const bodyParsed = setRolePermissionsBodySchema.safeParse(request.body);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }
      try {
        await setRolePermissions(app.prisma, paramParsed.data.id, bodyParsed.data.permissionIds);
        reply.send({ success: true });
      } catch (err) {
        reply.status(409).send({ success: false, error: err instanceof Error ? err.message : "Failed to update permissions" });
      }
    }
  );
}
