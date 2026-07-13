/**
 * Admin RBAC: group management service (CRUD + role assignment).
 */
import type { PrismaClient } from "@repo-sentinel/db";
import type { AdminGroupDto } from "@repo-sentinel/types";
import type { CreateGroupInput, UpdateGroupInput } from "../schemas/admin-schemas.js";
import { invalidateGroupPermissionCache } from "./permission-service.js";

function toDto(row: any): AdminGroupDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    isSystem: row.isSystem,
    memberCount: row._count?.members ?? 0,
    roles: (row.roles ?? []).map((r: any) => ({ id: r.role.id, name: r.role.name })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listGroups(prisma: PrismaClient): Promise<AdminGroupDto[]> {
  const rows = await prisma.userGroup.findMany({
    include: { roles: { include: { role: true } }, _count: { select: { members: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDto);
}

export async function createGroup(prisma: PrismaClient, input: CreateGroupInput): Promise<AdminGroupDto> {
  try {
    const row = await prisma.userGroup.create({ data: { name: input.name, description: input.description } });
    return toDto({ ...row, roles: [], _count: { members: 0 } });
  } catch (err: any) {
    if (err?.code === "P2002") throw new Error("A group with this name already exists");
    throw err;
  }
}

async function assertNotSystem(prisma: PrismaClient, id: string): Promise<void> {
  const row = await prisma.userGroup.findUnique({ where: { id } });
  if (!row) throw new Error("Group not found");
  if (row.isSystem) throw new Error("System groups cannot be renamed or deleted");
}

export async function updateGroup(prisma: PrismaClient, id: string, input: UpdateGroupInput): Promise<void> {
  await assertNotSystem(prisma, id);
  await prisma.userGroup.update({ where: { id }, data: input });
}

export async function deleteGroup(prisma: PrismaClient, id: string, force: boolean): Promise<void> {
  await assertNotSystem(prisma, id);
  const memberCount = await prisma.userGroupMembership.count({ where: { groupId: id } });
  if (memberCount > 0 && !force) {
    throw new Error(`This group has ${memberCount} member(s) — pass force=true to delete anyway`);
  }
  await prisma.userGroup.delete({ where: { id } });
}

export async function setGroupRoles(prisma: PrismaClient, id: string, roleIds: string[]): Promise<void> {
  await prisma.$transaction([
    prisma.userGroupRole.deleteMany({ where: { groupId: id } }),
    prisma.userGroupRole.createMany({ data: roleIds.map((roleId) => ({ groupId: id, roleId })) }),
  ]);
  await invalidateGroupPermissionCache(id);
}
