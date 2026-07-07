/**
 * Notification routes.
 *
 * GET    /api/notifications               — List with pagination (newest first)
 * GET    /api/notifications/unread-count  — Count of NEW notifications
 * PATCH  /api/notifications/:id/read      — Mark one as READ
 * PATCH  /api/notifications/read-all      — Mark all as READ
 * DELETE /api/notifications               — Clear all notifications
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from "../schemas/notification-schemas.js";
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  clearAllNotifications,
} from "../services/notification-persistence-service.js";

function handleZodError(error: { errors: { message: string }[] }, reply: FastifyReply): void {
  const message = error.errors[0]?.message ?? "Validation error";
  reply.status(400).send({ success: false, error: message });
}

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/notifications
  app.get("/api/notifications", { preHandler: [requireAuth, requirePermission(Resource.Notifications, Action.Read)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = listNotificationsQuerySchema.safeParse(request.query);
    if (!parsed.success) { handleZodError(parsed.error, reply); return; }

    const { page, limit } = parsed.data;
    const { notifications, total, totalPages } = await listNotifications(app.prisma, { page, limit });
    reply.send({
      success: true,
      data: notifications,
      total,
      page,
      perPage: limit,
      totalPages,
    });
  });

  // GET /api/notifications/unread-count (must be before :id route)
  app.get("/api/notifications/unread-count", { preHandler: [requireAuth, requirePermission(Resource.Notifications, Action.Read)] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const count = await getUnreadCount(app.prisma);
    reply.send({ success: true, data: { count } });
  });

  // PATCH /api/notifications/read-all (must be before :id/read route)
  app.patch("/api/notifications/read-all", { preHandler: [requireAuth, requirePermission(Resource.Notifications, Action.Update)] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await markAllAsRead(app.prisma);
    reply.send({ success: true, data: result });
  });

  // PATCH /api/notifications/:id/read
  app.patch("/api/notifications/:id/read", { preHandler: [requireAuth, requirePermission(Resource.Notifications, Action.Update)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = notificationIdParamSchema.safeParse(request.params);
    if (!parsed.success) { handleZodError(parsed.error, reply); return; }

    try {
      const notification = await markAsRead(app.prisma, parsed.data.id);
      reply.send({ success: true, data: notification });
    } catch {
      reply.status(404).send({ success: false, error: "Notification not found" });
    }
  });

  // DELETE /api/notifications
  app.delete("/api/notifications", { preHandler: [requireAuth, requirePermission(Resource.Notifications, Action.Delete)] }, async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await clearAllNotifications(app.prisma);
    reply.send({ success: true, data: result });
  });
}
