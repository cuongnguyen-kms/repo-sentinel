/**
 * Zod schemas for Admin RBAC management routes (users, groups, roles).
 */

import { z } from "zod";

export const userIdParamSchema = z.object({ id: z.string().min(1) });

export const createAdminUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  groupIds: z.array(z.string().min(1)).optional(),
});
export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;

export const updateAdminUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  banned: z.boolean().optional(),
  banReason: z.string().min(1).optional(),
  /** Seconds from now — matches better-auth's banUser API, NOT an absolute date. */
  banExpiresInSeconds: z.number().int().positive().optional(),
});
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export const setUserGroupsBodySchema = z.object({
  groupIds: z.array(z.string().min(1)),
});
export type SetUserGroupsInput = z.infer<typeof setUserGroupsBodySchema>;

export const groupIdParamSchema = z.object({ id: z.string().min(1) });

/** "Admin"/"Reviewer"/"Viewer" are reserved for the seeded system rows — new custom groups/roles
 *  must not reuse these names, or auth-seed.ts's boot-time upsert-by-name would silently take them over. */
const RESERVED_NAMES = ["Admin", "Reviewer", "Viewer"];
const nameSchema = z.string().min(1, "Name is required").refine((v) => !RESERVED_NAMES.includes(v), {
  message: "This name is reserved for a system role/group",
});

export const createGroupSchema = z.object({
  name: nameSchema,
  description: z.string().optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().optional(),
});
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const setGroupRolesBodySchema = z.object({
  roleIds: z.array(z.string().min(1)),
});
export type SetGroupRolesInput = z.infer<typeof setGroupRolesBodySchema>;

export const deleteQuerySchema = z.object({
  force: z.coerce.boolean().optional().default(false),
});

export const roleIdParamSchema = z.object({ id: z.string().min(1) });

export const createRoleSchema = z.object({
  name: nameSchema,
  description: z.string().optional(),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const setRolePermissionsBodySchema = z.object({
  permissionIds: z.array(z.string().min(1)),
});
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsBodySchema>;
