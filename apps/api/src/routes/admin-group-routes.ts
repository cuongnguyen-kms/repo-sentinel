/**
 * Admin RBAC: group management routes.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  createGroupSchema,
  updateGroupSchema,
  groupIdParamSchema,
  setGroupRolesBodySchema,
  deleteQuerySchema,
} from "../schemas/admin-schemas.js";
import { listGroups, createGroup, updateGroup, deleteGroup, setGroupRoles } from "../services/group-service.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({ success: false, error: "Validation failed", details: err.flatten().fieldErrors });
}

export async function registerAdminGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/groups",
    { preHandler: [requireAuth, requirePermission(Resource.Groups, Action.Read)] },
    async (_request, reply: FastifyReply) => {
      reply.send({ success: true, data: await listGroups(app.prisma) });
    }
  );

  app.post(
    "/api/admin/groups",
    { preHandler: [requireAuth, requirePermission(Resource.Groups, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createGroupSchema.safeParse(request.body);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      try {
        const dto = await createGroup(app.prisma, parsed.data);
        reply.status(201).send({ success: true, data: dto });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Failed to create group" });
      }
    }
  );

  app.patch(
    "/api/admin/groups/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Groups, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = groupIdParamSchema.safeParse(request.params);
      const bodyParsed = updateGroupSchema.safeParse(request.body);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }
      try {
        await updateGroup(app.prisma, paramParsed.data.id, bodyParsed.data);
        reply.send({ success: true });
      } catch (err) {
        reply.status(409).send({ success: false, error: err instanceof Error ? err.message : "Failed to update group" });
      }
    }
  );

  app.delete(
    "/api/admin/groups/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Groups, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = groupIdParamSchema.safeParse(request.params);
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
        await deleteGroup(app.prisma, paramParsed.data.id, queryParsed.data.force);
        reply.status(204).send();
      } catch (err) {
        reply.status(409).send({ success: false, error: err instanceof Error ? err.message : "Failed to delete group" });
      }
    }
  );

  app.put(
    "/api/admin/groups/:id/roles",
    { preHandler: [requireAuth, requirePermission(Resource.Groups, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = groupIdParamSchema.safeParse(request.params);
      const bodyParsed = setGroupRolesBodySchema.safeParse(request.body);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }
      try {
        await setGroupRoles(app.prisma, paramParsed.data.id, bodyParsed.data.roleIds);
        reply.send({ success: true });
      } catch (err) {
        reply.status(400).send({ success: false, error: err instanceof Error ? err.message : "Failed to update roles" });
      }
    }
  );
}
