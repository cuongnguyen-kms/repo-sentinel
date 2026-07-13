# Admin RBAC Management UI Design

Date: 2026-07-08

## Goal

Restore the admin CRUD UI for users, groups, roles, and permission assignments from RepoWatch into RepoSentinel. An Admin should be able to create/ban/delete users, assign them to groups, create custom groups/roles, assign roles to groups, and assign permissions to roles — all from `/admin/*` pages — without touching the database directly. The RBAC data model and `Resource` enum values (`Users`, `Groups`, `Roles`, `Permissions`) already exist in this repo (kept intentionally for forward-compat per `ROADMAP.md`); this slice adds only the write-side routes/services and the frontend pages.

## Scope

Included:

- Write-side CRUD routes/services for users, groups, and roles, plus a read-only permission catalog endpoint.
- Group↔role assignment (`PUT .../groups/:id/roles`) and role↔permission assignment (`PUT .../roles/:id/permissions`), replacing the assignment set wholesale per call.
- User↔group assignment (`PUT .../users/:id/groups`), including keeping the coarse `User.role` admin-bypass flag in sync with membership in the system `Admin` group (mirrors what `auth-seed.ts::seedAdminUser` already does for the bootstrap admin).
- User creation/ban/unban routed through better-auth's already-configured `admin()` plugin (`auth.api.createUser`/`banUser`/`unbanUser`) rather than raw Prisma writes, so password hashing and session invalidation stay consistent with the rest of the auth stack.
- Lockout guards: cannot delete your own account, cannot remove the last remaining member of the `Admin` group.
- System-row protection: `isSystem` groups/roles (`Admin`, `Reviewer`, `Viewer`) cannot be renamed or deleted; the `Admin` role's permission set specifically cannot be edited (it must always resolve to full access).
- Four Angular pages under `/admin/*` (`admin-users-page`, `admin-groups-page`, `admin-roles-page`, `admin-permissions-page`), gated by the existing `adminGuard` (`role === 'admin'`) plus the existing `permissionGuard`/`Resource.{Users,Groups,Roles,Permissions}:Read` pattern used everywhere else, and a sidebar nav "Admin" section visible only when `AuthService.isAdmin()`.
- Cache invalidation wired into every mutation via the existing `invalidatePermissionCache`/`invalidateGroupPermissionCache` (`services/permission-service.ts` — unchanged).

Excluded:

- Self-service invite emails, SSO, or magic-link sign-up — no email service exists in this repo; user creation sets a password directly.
- Ad-hoc `Permission` row creation/deletion — the `Resource × Action` cross product is fixed by the `Resource` enum and fully seeded by `auth-seed.ts` already; only *assignment* (which roles have which permissions) is editable here.
- Bulk import/export of users, groups, or roles.
- An audit log of admin actions (a future roadmap item, not requested here).
- Granting `Users`/`Groups`/`Roles`/`Permissions` permissions to the `Reviewer`/`Viewer` roles — RBAC management stays Admin-only by design (see Permissions section).

## Existing Context

RepoSentinel already has:

- Full Prisma models: `User` (`role` string field, `banned`/`banReason`/`banExpires`), `UserGroup` (`isSystem`), `Role` (`isSystem`), `Permission`, `RolePermission`, `UserGroupRole`, `UserGroupMembership` — nothing to add to `schema.prisma`.
- `Resource.Users`/`Groups`/`Roles`/`Permissions` already in `packages/types/src/enums.ts`'s 14-value `Resource` enum (and mirrored in `apps/web/.../core/models/enums.ts`) — no enum changes needed.
- `apps/api/src/services/permission-service.ts` (read-side): `getUserPermissions` (admin `role` bypasses to `["*"]`; otherwise resolves through `UserGroupMembership → UserGroupRole → RolePermission`, cached in Redis for 5 min), plus `invalidatePermissionCache(userId)`/`invalidateGroupPermissionCache(groupId)` — both reusable as-is.
- `apps/api/src/middleware/permission-middleware.ts::requirePermission(resource, action)` — the standard route guard used everywhere; this feature uses it identically, no changes.
- `apps/api/src/lib/auth.ts` — better-auth already configured with the `admin()` plugin (from `better-auth/plugins`), email/password auth, and a Prisma adapter. This plugin exposes `auth.api.createUser`, `auth.api.banUser`, `auth.api.unbanUser`, `auth.api.setUserPassword`, etc. — the write-side user service should call these instead of writing to the `User`/`Account` tables directly.
- `apps/api/src/lib/auth-seed.ts` — idempotently seeds the full `Resource × Action` permission set and the three system roles/groups (`Admin`: `"*"`; `Reviewer`/`Viewer`: explicit subsets) on every boot, and bootstraps one admin user from `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` env vars (setting both `UserGroupMembership` into `Admin` **and** `User.role = "admin"`). This is the precedent this spec's `setUserGroups` follows for keeping the two admin signals in sync.
- Frontend: `apps/web/src/app/core/guards/admin.guard.ts` (`adminGuard` — redirects to `/` unless `AuthService.isAdmin()`, i.e. `user.role === 'admin'`) and `permission.guard.ts` (`permissionGuard` — generic `Resource`/`Action` route-data guard) already exist and are wired into `app.routes.ts`'s per-route `canActivate` pattern. `PermissionsService.can()` and `SidebarNav`'s `isAdmin` are already exposed for reuse.
- `features/repositories/repositories-page/` and `features/connections/connections-page/` as the existing CRUD-table-plus-dialog UI pattern to mirror (`MatTableModule` list + `MatDialog` create/edit forms + inline row actions), following the `<domain>-page/` + `<domain>.service.ts` + dialogs-as-siblings structure noted in `CLAUDE.md`.

Two RBAC signals coexist by design and both must stay consistent after this feature ships:

1. **Coarse bypass** — `User.role === "admin"` (better-auth's own field). `AdminGuard`/`isAdmin()` check this directly; `permission-service.ts` treats it as an automatic `["*"]` grant.
2. **Fine-grained grants** — `UserGroupMembership → UserGroupRole → RolePermission`, resolved per-request and cached.

A user assigned to the system `Admin` group already gets `"*"` via signal 2 (the `Admin` role has every permission). This spec additionally flips `User.role` to `"admin"` when a user is added to the `Admin` group (and back to `"user"` when removed and no longer a member of it), so `/admin/*` page access and full-permission-bypass stay in lockstep — exactly what `auth-seed.ts::seedAdminUser` already does for the bootstrap account.

The original `../repo-watch-main/repo-watch-main` source provides reference behavior for `services/user-service.ts`, `services/group-service.ts`, `services/role-service.ts`, and the corresponding `routes/admin-*-routes.ts`/`admin/*` pages named in `ROADMAP.md` §6 — adapt these, don't copy verbatim, since this repo's better-auth wiring and `isSystem` protections may differ.

## Data Model

No schema changes. This feature is pure CRUD/routes/services/frontend over models that already exist.

## Backend API

Add `apps/api/src/routes/admin-user-routes.ts`:

- `GET /api/admin/users` — list users (id, name, email, role, banned, banReason, banExpires, createdAt) with each user's group memberships (id/name). Permission: `Users/Read`.
- `POST /api/admin/users` — body `{ name, email, password, groupIds?: string[] }`. Creates the account via `auth.api.createUser`, then assigns initial groups via `setUserGroups`. Permission: `Users/Create`.
- `PATCH /api/admin/users/:id` — body `{ name?, email?, banned?, banReason?, banExpires? }`. Name/email update via Prisma; ban-state changes via `auth.api.banUser`/`unbanUser`. Permission: `Users/Update`.
- `DELETE /api/admin/users/:id` — deletes the user (cascades `Session`/`Account`/`UserGroupMembership` via existing `onDelete: Cascade`). Rejects deleting your own account or the last remaining `Admin`-group member. Permission: `Users/Delete`.
- `PUT /api/admin/users/:id/groups` — body `{ groupIds: string[] }`. Replaces group memberships wholesale; syncs `User.role` admin flag; invalidates the user's permission cache. Rejects if it would remove the last remaining `Admin`-group member. Permission: `Users/Update`.

Add `apps/api/src/routes/admin-group-routes.ts`:

- `GET /api/admin/groups` — list groups with member count and assigned role names. Permission: `Groups/Read`.
- `POST /api/admin/groups` — body `{ name, description? }`. Permission: `Groups/Create`.
- `PATCH /api/admin/groups/:id` — body `{ name?, description? }`. Rejects for `isSystem` groups. Permission: `Groups/Update`.
- `DELETE /api/admin/groups/:id` — rejects for `isSystem` groups, and rejects (409, listing affected member count) unless `?force=true` when the group still has members — pass `force=true` to cascade-delete `UserGroupMembership`/`UserGroupRole` rows for it. Permission: `Groups/Delete`.
- `PUT /api/admin/groups/:id/roles` — body `{ roleIds: string[] }`. Replaces role assignments wholesale; calls `invalidateGroupPermissionCache`. Permission: `Groups/Update`.

Add `apps/api/src/routes/admin-role-routes.ts`:

- `GET /api/admin/roles` — list roles with permission count and assigned-group count. Permission: `Roles/Read`.
- `POST /api/admin/roles` — body `{ name, description? }`. Permission: `Roles/Create`.
- `PATCH /api/admin/roles/:id` — body `{ name?, description? }`. Rejects for `isSystem` roles. Permission: `Roles/Update`.
- `DELETE /api/admin/roles/:id` — rejects for `isSystem` roles, and rejects (409, listing affected group names) unless `?force=true` when any group is still assigned this role. Permission: `Roles/Delete`.
- `PUT /api/admin/roles/:id/permissions` — body `{ permissionIds: string[] }`. Rejects for the `Admin` role specifically (must always resolve to full access). Replaces `RolePermission` rows wholesale; calls `invalidateGroupPermissionCache` for every group currently assigned this role. Permission: `Roles/Update`.

Add `apps/api/src/routes/admin-permission-routes.ts`:

- `GET /api/admin/permissions` — read-only catalog: `{ id, resource, action }[]`, grouped by resource for the role-permission checkbox matrix. No create/update/delete (see Scope). Permission: `Permissions/Read`.

Register all four in `apps/api/src/index.ts`, following the existing registration pattern.

## Backend Services

`apps/api/src/services/user-service.ts`:

- `listUsers(prisma)` — users + their group memberships.
- `createUser(auth, prisma, input)` — `auth.api.createUser({ body: { name, email, password } })`, then `setUserGroups` for any initial `groupIds`.
- `updateUser(auth, prisma, id, input)` — Prisma update for `name`/`email`; `auth.api.banUser`/`unbanUser` for ban-state changes.
- `deleteUser(prisma, requestingUserId, id)` — throws if `id === requestingUserId` or if `id` is the last member of the `Admin` group; otherwise `prisma.user.delete`.
- `setUserGroups(prisma, id, groupIds)` — in a transaction: replace `UserGroupMembership` rows for `id`; if the target group set includes the system `Admin` group, set `User.role = "admin"`, else `"user"`; guard against removing the last `Admin`-group member; call `invalidatePermissionCache(id)` after commit.

`apps/api/src/services/group-service.ts`:

- `listGroups(prisma)`, `createGroup(prisma, input)`, `updateGroup(prisma, id, input)` (guards `isSystem`), `deleteGroup(prisma, id, force)` (guards `isSystem`; requires `force` when members exist), `setGroupRoles(prisma, id, roleIds)` (replace `UserGroupRole` rows, then `invalidateGroupPermissionCache(id)`).

`apps/api/src/services/role-service.ts`:

- `listRoles(prisma)`, `createRole(prisma, input)`, `updateRole(prisma, id, input)` (guards `isSystem`), `deleteRole(prisma, id, force)` (guards `isSystem`; requires `force` when any group is assigned), `setRolePermissions(prisma, id, permissionIds)` (guards the `Admin` role by name+`isSystem`; replace `RolePermission` rows; then `invalidateGroupPermissionCache` for every group whose `UserGroupRole` references this role).

No new service needed for the read-only permission catalog — a one-line `prisma.permission.findMany()` directly in `admin-permission-routes.ts` is enough (matches how `review-routes.ts` inlines trivial reads elsewhere in this repo).

## Frontend

New `apps/web/src/app/features/admin/` module (file layout mirrors `features/repositories/`):

- `admin-users/admin-users.service.ts`, `admin-users-page/` (table: name, email, role badge, banned badge, groups chips, actions), `user-form-dialog/` (create/edit: name/email/password-on-create, multi-select group chips).
- `admin-groups/admin-groups.service.ts`, `admin-groups-page/` (table: name, member count, roles chips, actions — disabled rename/delete for `isSystem` rows), `group-form-dialog/` (create/edit name/description), `group-roles-dialog/` (checkbox list of roles).
- `admin-roles/admin-roles.service.ts`, `admin-roles-page/` (table: name, permission count, group count, actions — disabled rename/delete for `isSystem` rows), `role-form-dialog/` (create/edit name/description), `role-permissions-dialog/` (permission matrix: rows grouped by `Resource`, columns `Create/Read/Update/Delete` checkboxes — disabled entirely when the role is `Admin`).
- `admin-permissions/admin-permissions.service.ts`, `admin-permissions-page/` (read-only table of the full `Resource × Action` catalog, grouped by resource — no actions).

`app.routes.ts`: add an `/admin` branch (following the existing per-child `canActivate: [permissionGuard]` pattern, plus `adminGuard` as a parent-level gate):

```ts
{
  path: 'admin',
  canActivate: [adminGuard],
  children: [
    { path: 'users', canActivate: [permissionGuard], data: { resource: Resource.Users, action: Action.Read }, loadComponent: () => import(...).then((m) => m.AdminUsersPage) },
    { path: 'groups', canActivate: [permissionGuard], data: { resource: Resource.Groups, action: Action.Read }, loadComponent: () => import(...).then((m) => m.AdminGroupsPage) },
    { path: 'roles', canActivate: [permissionGuard], data: { resource: Resource.Roles, action: Action.Read }, loadComponent: () => import(...).then((m) => m.AdminRolesPage) },
    { path: 'permissions', canActivate: [permissionGuard], data: { resource: Resource.Permissions, action: Action.Read }, loadComponent: () => import(...).then((m) => m.AdminPermissionsPage) },
  ],
},
```

`sidebar-nav.ts`: add an "Admin" section with four sub-items (Users/Groups/Roles/Permissions), rendered only when `this.isAdmin()` is true (reuse the existing `isAdmin` computed already exposed by `SidebarNav`) — a stricter gate than the existing `NAV_ITEMS.filter(... permissions.can(...))` pattern, matching `adminGuard`'s own strictness.

## Settings

None — this feature adds no `AppSetting` keys.

## Error Handling

- User create: better-auth `createUser` failures (duplicate email, weak password) surfaced as `422` with the underlying message.
- User delete/group-removal: `400` "cannot delete your own account" / "cannot remove the last Admin group member" — both routed through the same `assertNotLastAdmin` guard in `user-service.ts`.
- Group/Role rename or delete on an `isSystem` row: `409` "system groups/roles cannot be renamed or deleted".
- Group/Role delete while still referenced (members / assigned groups) without `?force=true`: `409` listing the blocking count/names.
- Role-permission edit on the `Admin` role: `409` "the Admin role's permissions cannot be modified".
- All mutation routes that change effective permissions call `invalidatePermissionCache`/`invalidateGroupPermissionCache` before returning success — a user's next request always sees fresh permissions, never a stale 5-minute-old cached set.

## Permissions

No enum changes — `Resource.Users`/`Groups`/`Roles`/`Permissions` already exist and are already fully seeded into the `Permission` table by `auth-seed.ts`. No changes to the `Reviewer`/`Viewer` role definitions: RBAC management stays Admin-only, gated by `adminGuard` (`role === 'admin'`) on the frontend and by `Admin`'s existing `"*"` grant on the backend — consistent with how this area was already scoped in `ROADMAP.md` (an `AdminGuard`, not a granular permission, is the intended gate).

## Tests

Backend:

- `user-service`: `createUser` calls `auth.api.createUser` then assigns groups; `setUserGroups` flips `User.role` to `admin`/`user` correctly; `deleteUser`/`setUserGroups` reject removing the last `Admin`-group member or self-deletion; cache invalidation is called after every mutation.
- `group-service`/`role-service`: reject rename/delete of `isSystem` rows; reject delete-in-use without `force`; `setGroupRoles`/`setRolePermissions` call the correct cache-invalidation function(s) for every affected group.
- `role-service`: `setRolePermissions` rejects when the target role is `Admin`.
- Route schemas: reject malformed emails/passwords, empty `groupIds`/`roleIds`/`permissionIds` where required, and non-existent ids.

Frontend:

- `AdminUsersService`/`AdminGroupsService`/`AdminRolesService`/`AdminPermissionsService` build the expected API requests.
- Each admin page renders `isSystem` rows with disabled rename/delete actions.
- `role-permissions-dialog` renders the checkbox matrix as fully disabled when editing the `Admin` role.
- Sidebar "Admin" section only renders for `isAdmin() === true`.

## Rollout Notes

No Prisma migration — the data model already exists and is already seeded on every boot by `auth-seed.ts`. This feature only adds new routes/services (gated behind `Users/Groups/Roles/Permissions` permissions, which today only `Admin` holds via `"*"`) and new frontend pages behind `adminGuard`. No existing behavior changes for non-admin users, and no behavior changes for admins until they actually use the new pages.

## Acceptance Criteria

- An Admin can create a new user (name/email/password), assign them to one or more groups, and see the change take effect on that user's very next request (cache invalidated immediately).
- An Admin can ban/unban a user, and cannot delete their own account or remove the last remaining member of the `Admin` group.
- An Admin can create a custom group, assign it one or more roles, and add/remove group members — `isSystem` groups (`Admin`/`Reviewer`/`Viewer`) cannot be renamed or deleted.
- An Admin can create a custom role and assign it a subset of the full permission catalog — `isSystem` roles cannot be renamed or deleted, and the `Admin` role's permission set specifically cannot be edited.
- The `/admin/*` pages are reachable only by users with `role === 'admin'`, and each page's data is additionally gated by the matching `Resource:Read` permission, matching every other route in this app.
- Existing review/PR/connection/settings behavior, and the existing `Admin`/`Reviewer`/`Viewer` seeded roles, are completely unaffected until an admin explicitly uses the new UI to change something.
