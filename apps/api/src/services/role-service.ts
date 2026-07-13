/**
 * Admin RBAC: role management service (CRUD + permission assignment).
 */
import type { PrismaClient } from "@repo-sentinel/db";
import type { AdminRoleDto } from "@repo-sentinel/types";
import type { CreateRoleInput, UpdateRoleInput } from "../schemas/admin-schemas.js";
import { invalidateGroupPermissionCache } from "./permission-service.js";

function toDto(row: any): AdminRoleDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    isSystem: row.isSystem,
    permissionCount: row._count?.permissions ?? 0,
    groupCount: row._count?.groups ?? 0,
    permissionIds: (row.permissions ?? []).map((p: any) => p.permissionId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRoles(prisma: PrismaClient): Promise<AdminRoleDto[]> {
  const rows = await prisma.role.findMany({
    include: { permissions: true, _count: { select: { permissions: true, groups: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toDto);
}

export async function createRole(prisma: PrismaClient, input: CreateRoleInput): Promise<AdminRoleDto> {
  try {
    const row = await prisma.role.create({ data: { name: input.name, description: input.description } });
    return toDto({ ...row, permissions: [], _count: { permissions: 0, groups: 0 } });
  } catch (err: any) {
    if (err?.code === "P2002") throw new Error("A role with this name already exists");
    throw err;
  }
}

async function requireRole(prisma: PrismaClient, id: string): Promise<{ id: string; name: string; isSystem: boolean }> {
  const row = await prisma.role.findUnique({ where: { id } });
  if (!row) throw new Error("Role not found");
  return row;
}

export async function updateRole(prisma: PrismaClient, id: string, input: UpdateRoleInput): Promise<void> {
  const role = await requireRole(prisma, id);
  if (role.isSystem) throw new Error("System roles cannot be renamed or deleted");
  await prisma.role.update({ where: { id }, data: input });
}

export async function deleteRole(prisma: PrismaClient, id: string, force: boolean): Promise<void> {
  const role = await requireRole(prisma, id);
  if (role.isSystem) throw new Error("System roles cannot be renamed or deleted");
  const groupCount = await prisma.userGroupRole.count({ where: { roleId: id } });
  if (groupCount > 0 && !force) {
    throw new Error(`This role is assigned to ${groupCount} group(s) — pass force=true to delete anyway`);
  }
  await prisma.role.delete({ where: { id } });
}

/** Replaces a role's permission set wholesale. Rejects for the Admin role — it must always resolve to full access. */
export async function setRolePermissions(prisma: PrismaClient, id: string, permissionIds: string[]): Promise<void> {
  const role = await requireRole(prisma, id);
  if (role.isSystem && role.name === "Admin") {
    throw new Error("The Admin role's permissions cannot be modified");
  }

  const affectedGroups = await prisma.userGroupRole.findMany({ where: { roleId: id } });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: id } }),
    prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) }),
  ]);

  for (const g of affectedGroups) {
    await invalidateGroupPermissionCache(g.groupId);
  }
}
