/**
 * Notification persistence service.
 * Handles CRUD for the Notification model in PostgreSQL.
 * Named to distinguish from notification-service.ts (Socket.IO emitters).
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { NotificationDto } from "@repo-sentinel/types";
import { NotificationType, NotificationStatus } from "@repo-sentinel/types";

// Re-export for use in other modules
export { NotificationType, NotificationStatus };

/**
 * Parse stored JSON metadata string to object. Returns null on invalid JSON.
 */
function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Map a Prisma Notification record to a DTO for API responses.
 */
function toDto(n: {
  id: string;
  type: string;
  status: string;
  title: string;
  message: string | null;
  metadata: string | null;
  createdAt: Date;
  readAt: Date | null;
}): NotificationDto {
  return {
    id: n.id,
    type: n.type as NotificationType,
    status: n.status as NotificationStatus,
    title: n.title,
    message: n.message,
    metadata: parseMetadata(n.metadata),
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
  };
}

export async function listNotifications(
  prisma: PrismaClient,
  { page, limit, where }: { page: number; limit: number; where?: Record<string, unknown> }
): Promise<{ notifications: NotificationDto[]; total: number; totalPages: number }> {
  const skip = (page - 1) * limit;
  const [notifications, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);
  return {
    notifications: notifications.map(toDto),
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getUnreadCount(prisma: PrismaClient): Promise<number> {
  return prisma.notification.count({ where: { status: "NEW" } });
}

export async function markAsRead(
  prisma: PrismaClient,
  id: string
): Promise<NotificationDto> {
  const updated = await prisma.notification.update({
    where: { id },
    data: { status: "READ", readAt: new Date() },
  });
  return toDto(updated);
}

export async function markAllAsRead(
  prisma: PrismaClient
): Promise<{ count: number }> {
  const result = await prisma.notification.updateMany({
    where: { status: "NEW" },
    data: { status: "READ", readAt: new Date() },
  });
  return { count: result.count };
}

export async function clearAllNotifications(
  prisma: PrismaClient
): Promise<{ count: number }> {
  const result = await prisma.notification.deleteMany();
  return { count: result.count };
}

/**
 * Create a notification record. Fire-and-forget safe — callers wrap in .catch().
 */
export async function createNotification(
  prisma: PrismaClient,
  {
    type,
    title,
    message,
    metadata,
  }: {
    type: NotificationType;
    title: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await prisma.notification.create({
    data: {
      type,
      title,
      message: message ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
}
