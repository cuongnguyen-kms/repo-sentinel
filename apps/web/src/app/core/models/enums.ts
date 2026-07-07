/**
 * Shared enums mirroring @repo-sentinel/types (packages/types/src/enums.ts).
 * Hand-ported rather than imported from the workspace package to keep the
 * Angular build's module resolution simple.
 */

export enum PrState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  MERGED = 'MERGED',
}

export enum ReviewStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  IN_PROGRESS = 'IN_PROGRESS',
  REVIEWED = 'REVIEWED',
  UPDATED = 'UPDATED',
  FAILED = 'FAILED',
}

export enum AiReviewStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum NotificationType {
  PR_NEW = 'PR_NEW',
  PR_MERGED = 'PR_MERGED',
  PR_CLOSED = 'PR_CLOSED',
  REVIEW_OUTDATED = 'REVIEW_OUTDATED',
  REVIEW_COMPLETED = 'REVIEW_COMPLETED',
  REVIEW_FAILED = 'REVIEW_FAILED',
  REVIEW_CANCELLED = 'REVIEW_CANCELLED',
}

export enum NotificationStatus {
  NEW = 'NEW',
  READ = 'READ',
}

/** RBAC resource identifiers — must match Permission table resource column. MVP subset only. */
export enum Resource {
  Connections = 'connections',
  Dashboard = 'dashboard',
  Groups = 'groups',
  Notifications = 'notifications',
  Permissions = 'permissions',
  PullRequests = 'pull-requests',
  Repos = 'repos',
  Reviews = 'reviews',
  Roles = 'roles',
  Settings = 'settings',
  Users = 'users',
}

export enum Action {
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
}
