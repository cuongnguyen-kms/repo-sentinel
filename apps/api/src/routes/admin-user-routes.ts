/**
 * Admin RBAC: user management routes.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { fromNodeHeaders } from "better-auth/node";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  createAdminUserSchema,
  updateAdminUserSchema,
  userIdParamSchema,
  setUserGroupsBodySchema,
} from "../schemas/admin-schemas.js";
import { listUsers, createUser, updateUser, deleteUser, setUserGroups } from "../services/user-service.js";
import { auth } from "../lib/auth.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({ success: false, error: "Validation failed", details: err.flatten().fieldErrors });
}

export async function registerAdminUserRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/admin/users",
    { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Read)] },
    async (_request, reply: FastifyReply) => {
      reply.send({ success: true, data: await listUsers(app.prisma) });
    }
  );

  app.post(
    "/api/admin/users",
    { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createAdminUserSchema.safeParse(request.body);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      try {
        await createUser(auth, app.prisma, fromNodeHeaders(request.headers), parsed.data);
        reply.status(201).send({ success: true });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Failed to create user" });
      }
    }
  );

  app.patch(
    "/api/admin/users/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = userIdParamSchema.safeParse(request.params);
      const bodyParsed = updateAdminUserSchema.safeParse(request.body);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }
      try {
        await updateUser(auth, app.prisma, fromNodeHeaders(request.headers), paramParsed.data.id, bodyParsed.data);
        reply.send({ success: true });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Failed to update user" });
      }
    }
  );

  app.delete(
    "/api/admin/users/:id",
    { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = userIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      try {
        await deleteUser(app.prisma, request.user.id, parsed.data.id);
        reply.status(204).send();
      } catch (err) {
        reply.status(400).send({ success: false, error: err instanceof Error ? err.message : "Failed to delete user" });
      }
    }
  );

  app.put(
    "/api/admin/users/:id/groups",
    { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = userIdParamSchema.safeParse(request.params);
      const bodyParsed = setUserGroupsBodySchema.safeParse(request.body);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }
      try {
        await setUserGroups(app.prisma, paramParsed.data.id, bodyParsed.data.groupIds);
        reply.send({ success: true });
      } catch (err) {
        reply.status(400).send({ success: false, error: err instanceof Error ? err.message : "Failed to update groups" });
      }
    }
  );
}
