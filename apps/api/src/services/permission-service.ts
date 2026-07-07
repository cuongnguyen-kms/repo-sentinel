/**
 * Loads and caches user permissions from DB.
 * Admin users bypass permission checks entirely.
 * Non-admin permissions are cached in Redis for 5 minutes.
 */
import { prisma } from "@repo-sentinel/db";
import { redis } from "../lib/redis.js";
const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = "user-perms:";

export interface UserPermissions {
  userId: string;
  role: string;
  permissions: Set<string>;
}

export async function getUserPermissions(userId: string, role: string): Promise<UserPermissions> {
  if (role === "admin") {
    return { userId, role, permissions: new Set(["*"]) };
  }

  const cached = await redis.get(`${CACHE_PREFIX}${userId}`);
  if (cached) {
    try {
      return { userId, role, permissions: new Set(JSON.parse(cached) as string[]) };
    } catch {
      // Corrupt cache entry — delete and fall through to DB lookup
      await redis.del(`${CACHE_PREFIX}${userId}`);
    }
  }

  const memberships = await prisma.userGroupMembership.findMany({
    where: { userId },
    include: {
      group: {
        include: {
          roles: {
            include: {
              role: {
                include: {
                  permissions: { include: { permission: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const permSet = new Set<string>();
  for (const m of memberships) {
    for (const gr of m.group.roles) {
      for (const rp of gr.role.permissions) {
        permSet.add(`${rp.permission.resource}:${rp.permission.action}`);
      }
    }
  }

  await redis.setex(`${CACHE_PREFIX}${userId}`, CACHE_TTL, JSON.stringify([...permSet]));
  return { userId, role, permissions: permSet };
}

export async function invalidatePermissionCache(userId: string): Promise<void> {
  await redis.del(`${CACHE_PREFIX}${userId}`);
}

export async function invalidateGroupPermissionCache(groupId: string): Promise<void> {
  const members = await prisma.userGroupMembership.findMany({
    where: { groupId },
    select: { userId: true },
  });
  const pipeline = redis.pipeline();
  for (const m of members) {
    pipeline.del(`${CACHE_PREFIX}${m.userId}`);
  }
  await pipeline.exec();
}
