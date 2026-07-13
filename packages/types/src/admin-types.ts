/** DTOs for the Admin RBAC management UI (users, groups, roles, permission catalog). */

export interface AdminUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  createdAt: string;
  groups: Array<{ id: string; name: string }>;
}

export interface CreateAdminUserInput {
  name: string;
  email: string;
  password: string;
  groupIds?: string[];
}

export interface UpdateAdminUserInput {
  name?: string;
  email?: string;
  banned?: boolean;
  banReason?: string;
  /** Seconds from now — matches better-auth's banUser API, NOT an absolute date. */
  banExpiresInSeconds?: number;
}

export interface AdminGroupDto {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  roles: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRoleDto {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionCount: number;
  groupCount: number;
  permissionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PermissionDto {
  id: string;
  resource: string;
  action: string;
}
