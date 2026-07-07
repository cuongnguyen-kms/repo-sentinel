/**
 * requirePermission - Factory returning a preHandler that checks resource:action permission.
 * Must be used AFTER requireAuth (depends on request.user being populated).
 * Admin role bypasses all permission checks.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Resource, Action } from "@repo-sentinel/types";
import { getUserPermissions } from "../services/permission-service.js";

export function requirePermission(resource: Resource, action: Action): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: userId, role } = request.user;
    const userPerms = await getUserPermissions(userId, role);

    if (userPerms.permissions.has("*")) return;

    const required = `${resource}:${action}`;
    if (!userPerms.permissions.has(required)) {
      return reply.status(403).send({
        error: "Forbidden",
        code: "INSUFFICIENT_PERMISSIONS",
        required,
      });
    }
  };
}
