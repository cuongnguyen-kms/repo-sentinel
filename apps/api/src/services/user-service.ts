/**
 * Admin RBAC: user management service.
 * Account mutations (create/ban/unban) route through better-auth's admin() plugin
 * so password hashing and session invalidation stay correct; group membership is
 * plain Prisma, followed by a permission-cache invalidation.
 */
import type { PrismaClient } from "@repo-sentinel/db";
import type { AdminUserDto, CreateAdminUserInput, UpdateAdminUserInput } from "@repo-sentinel/types";
import { invalidatePermissionCache } from "./permission-service.js";
import type { auth as AuthInstance } from "../lib/auth.js";

type Auth = typeof AuthInstance;

function toDto(row: any): AdminUserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    banned: row.banned ?? false,
    banReason: row.banReason ?? null,
    banExpires: row.banExpires ? row.banExpires.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    groups: (row.groupMemberships ?? []).map((m: any) => ({ id: m.group.id, name: m.group.name })),
  };
}

export async function listUsers(prisma: PrismaClient): Promise<AdminUserDto[]> {
  const rows = await prisma.user.findMany({
    include: { groupMemberships: { include: { group: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDto);
}

async function getAdminGroupId(prisma: PrismaClient): Promise<string | null> {
  const group = await prisma.userGroup.findUnique({ where: { name: "Admin" } });
  return group?.id ?? null;
}

/** Throws if removing `userId` from the Admin group would leave it with zero members. */
async function assertNotLastAdminMember(prisma: PrismaClient, userId: string, nextGroupIds: string[]): Promise<void> {
  const adminGroupId = await getAdminGroupId(prisma);
  if (!adminGroupId || nextGroupIds.includes(adminGroupId)) return;

  const members = await prisma.userGroupMembership.findMany({ where: { groupId: adminGroupId } });
  const isCurrentlyMember = members.some((m) => m.userId === userId);
  if (!isCurrentlyMember) return;

  const remaining = members.filter((m) => m.userId !== userId);
  if (remaining.length === 0) {
    throw new Error("Cannot remove the last remaining member of the Admin group");
  }
}

export async function createUser(
  auth: Auth,
  prisma: PrismaClient,
  headers: Headers,
  input: CreateAdminUserInput
): Promise<void> {
  const result = await auth.api.createUser({
    body: { name: input.name, email: input.email, password: input.password },
    headers,
  });
  if (input.groupIds && input.groupIds.length > 0) {
    await setUserGroups(prisma, result.user.id, input.groupIds);
  }
}

export async function updateUser(
  auth: Auth,
  _prisma: PrismaClient,
  headers: Headers,
  id: string,
  input: UpdateAdminUserInput
): Promise<void> {
  if (input.name !== undefined || input.email !== undefined) {
    await auth.api.adminUpdateUser({
      body: {
        userId: id,
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.email !== undefined && { email: input.email }),
        },
      },
      headers,
    });
  }
  if (input.banned === true) {
    await auth.api.banUser({
      body: { userId: id, banReason: input.banReason, banExpiresIn: input.banExpiresInSeconds },
      headers,
    });
  } else if (input.banned === false) {
    await auth.api.unbanUser({ body: { userId: id }, headers });
  }
}

/**
 * Deletes via raw Prisma (cascades Session/Account/UserGroupMembership through the existing
 * schema relations) rather than auth.api.removeUser, matching how deleteConnection already
 * relies on cascade deletes elsewhere in this repo.
 */
export async function deleteUser(prisma: PrismaClient, requestingUserId: string, id: string): Promise<void> {
  if (id === requestingUserId) throw new Error("Cannot delete your own account");
  await assertNotLastAdminMember(prisma, id, []);
  await prisma.user.delete({ where: { id } });
}

/** Replaces a user's group memberships wholesale and keeps User.role in sync with Admin-group membership. */
export async function setUserGroups(prisma: PrismaClient, id: string, groupIds: string[]): Promise<void> {
  await assertNotLastAdminMember(prisma, id, groupIds);

  const adminGroupId = await getAdminGroupId(prisma);
  const nextRole = adminGroupId && groupIds.includes(adminGroupId) ? "admin" : "user";

  await prisma.$transaction([
    prisma.userGroupMembership.deleteMany({ where: { userId: id } }),
    prisma.userGroupMembership.createMany({ data: groupIds.map((groupId) => ({ userId: id, groupId })) }),
    prisma.user.update({ where: { id }, data: { role: nextRole } }),
  ]);
  await invalidatePermissionCache(id);
}
