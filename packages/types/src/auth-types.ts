export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  image?: string | null;
}

export interface UserGroupSummary {
  id: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
}

export interface PermissionRecord {
  id: string;
  resource: string;
  action: string;
}
