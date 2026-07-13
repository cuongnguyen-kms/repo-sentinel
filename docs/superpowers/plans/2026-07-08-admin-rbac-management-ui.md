# Admin RBAC Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-08-admin-rbac-management-ui-design.md` — write-side CRUD routes/services for users, groups, and roles, a read-only permission catalog endpoint, and four `/admin/*` Angular pages, so an Admin can manage RBAC entirely from the UI instead of the database.

**Architecture:** No schema changes — every model (`User`, `UserGroup`, `Role`, `Permission`, `RolePermission`, `UserGroupRole`, `UserGroupMembership`) and every `Resource` enum value already exists. User account mutations (create/ban/unban/remove) route through better-auth's already-configured `admin()` plugin (`auth.api.*`) so password hashing and session invalidation stay correct; group/role/membership/assignment mutations are plain Prisma writes through new services, each followed by the existing `invalidatePermissionCache`/`invalidateGroupPermissionCache` calls. Every mutation that could affect page access re-syncs the coarse `User.role` admin-bypass flag with membership in the system `Admin` group.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Fastify, Vitest, better-auth (`admin()` plugin), Angular standalone components, Angular Material (`MatTableModule`, `MatSelectionList`).

**Reference:** `C:\KMS\Practice\repo-watch-main\repo-watch-main\apps\api\src\{routes/admin-*-routes.ts,services/{user,group,role}-service.ts}` for behavioral precedent only — this repo's better-auth wiring, `isSystem` protections, and admin-bypass-flag sync are RepoSentinel-specific and not in the original, so adapt rather than port.

**Critical implementation detail confirmed against `node_modules/better-auth/dist/plugins/admin/admin.d.mts` (v1.5.4, already installed — do not assume a different version's API shape):**

- `auth.api.createUser({ body: { email, password?, name, role?, data? }, headers })` → `{ user }`. Omit `role` on create — the new user starts as `"user"`; `Admin`-group membership (via `setUserGroups`) is what flips it to `"admin"`, not this call.
- `auth.api.banUser({ body: { userId, banReason?, banExpiresIn? }, headers })` → `{ user }`. **`banExpiresIn` is a duration in seconds from now, not an absolute timestamp** — the spec's `banExpires` is the read-side DB column name; the write-side route/service must accept `banExpiresInSeconds` and let better-auth compute the absolute expiry.
- `auth.api.unbanUser({ body: { userId }, headers })` → `{ user }`.
- `auth.api.removeUser({ body: { userId }, headers })` → `{ success }`.
- `auth.api.adminUpdateUser({ body: { userId, data: { name?, email? } }, headers })` → `UserWithRole`. Use this instead of a raw `prisma.user.update` for name/email so better-auth's own field-update hooks run.
- All of the above require `headers: fromNodeHeaders(request.headers)` (same helper `auth-middleware.ts` already uses) — better-auth's admin plugin independently re-checks that the *calling* session's `role` is in its own `adminRoles` list (default `["admin"]`) before allowing the call. This lines up with this feature's design (only `Admin`-role callers ever reach these routes), but the header must be threaded through every route → service call or better-auth will 403 the call even though our own `requirePermission` already passed.

---

## File Structure

Shared types:

- Create `packages/types/src/admin-types.ts`: `AdminUserDto`, `AdminGroupDto`, `AdminRoleDto`, `PermissionDto`, plus request-input types.
- Modify `packages/types/src/index.ts`: export the new module.
- Modify `apps/web/src/app/core/models/dto.ts`: mirror the same DTOs.

Backend schemas/routes:

- Create `apps/api/src/schemas/admin-schemas.ts`: all user/group/role param+body schemas.
- Create `apps/api/src/routes/admin-user-routes.ts`.
- Create `apps/api/src/routes/admin-group-routes.ts`.
- Create `apps/api/src/routes/admin-role-routes.ts`.
- Create `apps/api/src/routes/admin-permission-routes.ts`.
- Modify `apps/api/src/index.ts`: register all four.

Backend services:

- Create `apps/api/src/services/user-service.ts`.
- Create `apps/api/src/services/group-service.ts`.
- Create `apps/api/src/services/role-service.ts`.

Frontend:

- Create `apps/web/src/app/features/admin/admin-users/admin-users.service.ts`.
- Create `apps/web/src/app/features/admin/admin-users/admin-users-page/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-users/user-form-dialog/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-groups/admin-groups.service.ts`.
- Create `apps/web/src/app/features/admin/admin-groups/admin-groups-page/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-groups/group-form-dialog/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-groups/group-roles-dialog/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-roles/admin-roles.service.ts`.
- Create `apps/web/src/app/features/admin/admin-roles/admin-roles-page/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-roles/role-form-dialog/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-roles/role-permissions-dialog/` (`.ts`/`.html`/`.scss`).
- Create `apps/web/src/app/features/admin/admin-permissions/admin-permissions.service.ts`.
- Create `apps/web/src/app/features/admin/admin-permissions/admin-permissions-page/` (`.ts`/`.html`/`.scss`).
- Modify `apps/web/src/app/app.routes.ts`: add the `/admin` branch.
- Modify `apps/web/src/app/layout/sidebar-nav/sidebar-nav.ts` (+`.html`): add the Admin section.

Tests:

- Create `apps/api/src/__tests__/admin-schemas.test.ts`.
- Create `apps/api/src/__tests__/user-service.test.ts`.
- Create `apps/api/src/__tests__/group-service.test.ts`.
- Create `apps/api/src/__tests__/role-service.test.ts`.

## Implementation Tasks

### Task 1: Shared Types

**Files:**

- Create `packages/types/src/admin-types.ts`
- Modify `packages/types/src/index.ts`
- Modify `apps/web/src/app/core/models/dto.ts`

- [ ] **Step 1: Add the shared DTOs**

```ts
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
```

Add `export * from "./admin-types.js";` to `packages/types/src/index.ts`.

Hand-port the same interfaces into `apps/web/src/app/core/models/dto.ts` in a new "Admin RBAC" section, matching the existing hand-port convention (see `AtlassianConnectionDto` etc.).

- [ ] **Step 2: Build the types package**

Run: `npm run build --workspace=@repo-sentinel/types`

Expected: PASS.

- [ ] **Step 3: Checkpoint**

```bash
git add packages/types/src apps/web/src/app/core/models/dto.ts
git commit -m "feat: add Admin RBAC shared DTOs"
```

### Task 2: User Service and Routes

**Files:**

- Create `apps/api/src/schemas/admin-schemas.ts` (user-related schemas only in this task; group/role schemas added in Tasks 3-4)
- Create `apps/api/src/services/user-service.ts`
- Create `apps/api/src/routes/admin-user-routes.ts`
- Modify `apps/api/src/index.ts`
- Test `apps/api/src/__tests__/user-service.test.ts`
- Test `apps/api/src/__tests__/admin-schemas.test.ts`

- [ ] **Step 1: Add failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { createAdminUserSchema, setUserGroupsBodySchema, updateAdminUserSchema } from "../schemas/admin-schemas.js";

describe("admin-schemas (users)", () => {
  it("requires a password of at least 8 chars on create", () => {
    expect(createAdminUserSchema.safeParse({ name: "A", email: "a@b.com", password: "short" }).success).toBe(false);
    expect(createAdminUserSchema.safeParse({ name: "A", email: "a@b.com", password: "longenough1" }).success).toBe(true);
  });

  it("rejects malformed email", () => {
    expect(createAdminUserSchema.safeParse({ name: "A", email: "not-an-email", password: "longenough1" }).success).toBe(false);
  });

  it("accepts an empty groupIds array to clear all memberships", () => {
    expect(setUserGroupsBodySchema.safeParse({ groupIds: [] }).success).toBe(true);
  });

  it("update body allows partial fields", () => {
    expect(updateAdminUserSchema.safeParse({ banned: true, banReason: "abuse", banExpiresInSeconds: 3600 }).success).toBe(true);
    expect(updateAdminUserSchema.safeParse({}).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- admin-schemas.test.ts`

Expected before implementation: FAIL — module doesn't exist.

- [ ] **Step 3: Add the user-related schemas**

Create `admin-schemas.ts` (this file grows in Tasks 3-4; start it here):

```ts
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
  banExpiresInSeconds: z.number().int().positive().optional(),
});
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

export const setUserGroupsBodySchema = z.object({
  groupIds: z.array(z.string().min(1)),
});
export type SetUserGroupsInput = z.infer<typeof setUserGroupsBodySchema>;
```

- [ ] **Step 4: Write failing `user-service` tests**

Mock `../lib/auth.js` (the `auth` singleton) and Prisma.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/auth.js", () => ({
  auth: {
    api: {
      createUser: vi.fn().mockResolvedValue({ user: { id: "u_new", email: "new@co.com", name: "New" } }),
      banUser: vi.fn().mockResolvedValue({ user: {} }),
      unbanUser: vi.fn().mockResolvedValue({ user: {} }),
      removeUser: vi.fn().mockResolvedValue({ success: true }),
      adminUpdateUser: vi.fn().mockResolvedValue({}),
    },
  },
}));
vi.mock("../services/permission-service.js", () => ({
  invalidatePermissionCache: vi.fn().mockResolvedValue(undefined),
}));

describe("user-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userGroup: {
        findUnique: vi.fn().mockResolvedValue({ id: "grp_admin", name: "Admin" }),
      },
      userGroupMembership: {
        findMany: vi.fn().mockResolvedValue([{ userId: "u_other" }]),
        deleteMany: vi.fn().mockResolvedValue({}),
        createMany: vi.fn().mockResolvedValue({}),
      },
      user: {
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (fn: any) => (typeof fn === "function" ? fn(prisma) : Promise.all(fn))),
    };
  });

  it("createUser calls auth.api.createUser then assigns groups", async () => {
    const { createUser } = await import("../services/user-service.js");
    const { auth } = await import("../lib/auth.js");
    await createUser(auth as any, prisma, { name: "New", email: "new@co.com", password: "longenough1", groupIds: ["grp_1"] });
    expect(auth.api.createUser).toHaveBeenCalled();
  });

  it("setUserGroups flips role to admin when Admin group is included", async () => {
    const { setUserGroups } = await import("../services/user-service.js");
    await setUserGroups(prisma, "u_1", ["grp_admin"]);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "admin" }) }));
  });

  it("setUserGroups flips role back to user when Admin group is removed", async () => {
    const { setUserGroups } = await import("../services/user-service.js");
    await setUserGroups(prisma, "u_1", ["grp_other"]);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "user" }) }));
  });

  it("setUserGroups rejects removing the last Admin-group member", async () => {
    prisma.userGroupMembership.findMany.mockResolvedValue([{ userId: "u_1" }]); // only this user is in Admin
    const { setUserGroups } = await import("../services/user-service.js");
    await expect(setUserGroups(prisma, "u_1", [])).rejects.toThrow(/last remaining/i);
  });

  it("deleteUser rejects self-deletion", async () => {
    const { deleteUser } = await import("../services/user-service.js");
    await expect(deleteUser(prisma, "u_1", "u_1")).rejects.toThrow(/own account/i);
  });
});
```

- [ ] **Step 5: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- user-service.test.ts`

Expected before implementation: FAIL — module doesn't exist.

- [ ] **Step 6: Implement `user-service.ts`**

```ts
import type { PrismaClient } from "@repo-sentinel/db";
import { fromNodeHeaders } from "better-auth/node";
import type { AdminUserDto, CreateAdminUserInput, UpdateAdminUserInput } from "@repo-sentinel/types";
import { invalidatePermissionCache } from "./permission-service.js";
import type { auth as AuthInstance } from "../lib/auth.js";

type Auth = typeof AuthInstance;

function toDto(row: any): AdminUserDto {
  return {
    id: row.id, name: row.name, email: row.email, role: row.role,
    banned: row.banned ?? false, banReason: row.banReason ?? null,
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
  auth: Auth, prisma: PrismaClient, headers: HeadersInit, input: CreateAdminUserInput
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
  auth: Auth, prisma: PrismaClient, headers: HeadersInit, id: string, input: UpdateAdminUserInput
): Promise<void> {
  if (input.name !== undefined || input.email !== undefined) {
    await auth.api.adminUpdateUser({
      body: { userId: id, data: { ...(input.name !== undefined && { name: input.name }), ...(input.email !== undefined && { email: input.email }) } },
      headers,
    });
  }
  if (input.banned === true) {
    await auth.api.banUser({ body: { userId: id, banReason: input.banReason, banExpiresIn: input.banExpiresInSeconds }, headers });
  } else if (input.banned === false) {
    await auth.api.unbanUser({ body: { userId: id }, headers });
  }
}

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
```

Note: `deleteUser` calls `prisma.user.delete` directly (cascades `Session`/`Account`/`UserGroupMembership` via existing schema relations) rather than `auth.api.removeUser`, since the latter is a thin wrapper over the same delete and this repo already relies on cascade deletes elsewhere (see `deleteConnection`).

- [ ] **Step 7: Add `admin-user-routes.ts`**

```ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { fromNodeHeaders } from "better-auth/node";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import { createAdminUserSchema, updateAdminUserSchema, userIdParamSchema, setUserGroupsBodySchema } from "../schemas/admin-schemas.js";
import { listUsers, createUser, updateUser, deleteUser, setUserGroups } from "../services/user-service.js";
import { auth } from "../lib/auth.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({ success: false, error: "Validation failed", details: err.flatten().fieldErrors });
}

export async function registerAdminUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/users", { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Read)] },
    async (_request, reply: FastifyReply) => {
      reply.send({ success: true, data: await listUsers(app.prisma) });
    });

  app.post("/api/admin/users", { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createAdminUserSchema.safeParse(request.body);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      try {
        await createUser(auth, app.prisma, fromNodeHeaders(request.headers), parsed.data);
        reply.status(201).send({ success: true });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Failed to create user" });
      }
    });

  app.patch("/api/admin/users/:id", { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = userIdParamSchema.safeParse(request.params);
      const bodyParsed = updateAdminUserSchema.safeParse(request.body);
      if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }
      if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }
      try {
        await updateUser(auth, app.prisma, fromNodeHeaders(request.headers), paramParsed.data.id, bodyParsed.data);
        reply.send({ success: true });
      } catch (err) {
        reply.status(422).send({ success: false, error: err instanceof Error ? err.message : "Failed to update user" });
      }
    });

  app.delete("/api/admin/users/:id", { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = userIdParamSchema.safeParse(request.params);
      if (!parsed.success) { handleZodError(parsed.error, reply); return; }
      try {
        await deleteUser(app.prisma, request.user.id, parsed.data.id);
        reply.status(204).send();
      } catch (err) {
        reply.status(400).send({ success: false, error: err instanceof Error ? err.message : "Failed to delete user" });
      }
    });

  app.put("/api/admin/users/:id/groups", { preHandler: [requireAuth, requirePermission(Resource.Users, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = userIdParamSchema.safeParse(request.params);
      const bodyParsed = setUserGroupsBodySchema.safeParse(request.body);
      if (!paramParsed.success) { handleZodError(paramParsed.error, reply); return; }
      if (!bodyParsed.success) { handleZodError(bodyParsed.error, reply); return; }
      try {
        await setUserGroups(app.prisma, paramParsed.data.id, bodyParsed.data.groupIds);
        reply.send({ success: true });
      } catch (err) {
        reply.status(400).send({ success: false, error: err instanceof Error ? err.message : "Failed to update groups" });
      }
    });
}
```

- [ ] **Step 8: Register the route**

In `apps/api/src/index.ts`, import and register `registerAdminUserRoutes` (group with the other feature route registrations, e.g. after `registerSettingsRoutes`).

- [ ] **Step 9: Run tests and build**

```bash
npm test --workspace=@repo-sentinel/api -- admin-schemas.test.ts user-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 10: Checkpoint**

```bash
git add apps/api/src/schemas/admin-schemas.ts apps/api/src/services/user-service.ts apps/api/src/routes/admin-user-routes.ts apps/api/src/index.ts apps/api/src/__tests__/admin-schemas.test.ts apps/api/src/__tests__/user-service.test.ts
git commit -m "feat: add admin user management service and routes"
```

### Task 3: Group Service and Routes

**Files:**

- Modify `apps/api/src/schemas/admin-schemas.ts` (add group schemas)
- Create `apps/api/src/services/group-service.ts`
- Create `apps/api/src/routes/admin-group-routes.ts`
- Modify `apps/api/src/index.ts`
- Test `apps/api/src/__tests__/group-service.test.ts`

- [ ] **Step 1: Extend `admin-schemas.ts`**

```ts
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
```

Add tests to `admin-schemas.test.ts` asserting `createGroupSchema` rejects `"Admin"` as a name.

- [ ] **Step 2: Write failing `group-service` tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/permission-service.js", () => ({
  invalidateGroupPermissionCache: vi.fn().mockResolvedValue(undefined),
}));

describe("group-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userGroup: {
        create: vi.fn().mockResolvedValue({ id: "grp_1", name: "Custom", isSystem: false }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
      },
      userGroupMembership: { count: vi.fn().mockResolvedValue(0) },
      userGroupRole: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
    };
  });

  it("rejects updating a system group", async () => {
    prisma.userGroup.findUnique.mockResolvedValue({ id: "grp_admin", name: "Admin", isSystem: true });
    const { updateGroup } = await import("../services/group-service.js");
    await expect(updateGroup(prisma, "grp_admin", { name: "Renamed" })).rejects.toThrow(/system/i);
  });

  it("rejects deleting a group with members unless force=true", async () => {
    prisma.userGroup.findUnique.mockResolvedValue({ id: "grp_1", name: "Custom", isSystem: false });
    prisma.userGroupMembership.count.mockResolvedValue(2);
    const { deleteGroup } = await import("../services/group-service.js");
    await expect(deleteGroup(prisma, "grp_1", false)).rejects.toThrow(/force/i);
    await expect(deleteGroup(prisma, "grp_1", true)).resolves.toBeUndefined();
  });

  it("setGroupRoles replaces role assignments and invalidates cache", async () => {
    const { setGroupRoles } = await import("../services/group-service.js");
    const { invalidateGroupPermissionCache } = await import("../services/permission-service.js");
    await setGroupRoles(prisma, "grp_1", ["role_1"]);
    expect(prisma.userGroupRole.deleteMany).toHaveBeenCalled();
    expect(invalidateGroupPermissionCache).toHaveBeenCalledWith("grp_1");
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- group-service.test.ts`

Expected before implementation: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `group-service.ts`**

```ts
import type { PrismaClient } from "@repo-sentinel/db";
import type { AdminGroupDto, CreateGroupInput, UpdateGroupInput } from "@repo-sentinel/types";
import { invalidateGroupPermissionCache } from "./permission-service.js";

function toDto(row: any): AdminGroupDto {
  return {
    id: row.id, name: row.name, description: row.description ?? null, isSystem: row.isSystem,
    memberCount: row._count?.members ?? 0,
    roles: (row.roles ?? []).map((r: any) => ({ id: r.role.id, name: r.role.name })),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
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
```

- [ ] **Step 5: Add `admin-group-routes.ts`**

Mirror the shape of `admin-user-routes.ts` (GET/POST/PATCH/DELETE + `PUT .../roles`), using `deleteQuerySchema` for the `?force=true` query on DELETE. Permission checks per the spec's route list (`Resource.Groups`, Create/Read/Update/Delete).

- [ ] **Step 6: Register the route**

In `apps/api/src/index.ts`, import and register `registerAdminGroupRoutes`.

- [ ] **Step 7: Run tests and build**

```bash
npm test --workspace=@repo-sentinel/api -- admin-schemas.test.ts group-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

```bash
git add apps/api/src/schemas/admin-schemas.ts apps/api/src/services/group-service.ts apps/api/src/routes/admin-group-routes.ts apps/api/src/index.ts apps/api/src/__tests__/group-service.test.ts
git commit -m "feat: add admin group management service and routes"
```

### Task 4: Role Service, Permission Catalog Route

**Files:**

- Modify `apps/api/src/schemas/admin-schemas.ts` (add role schemas)
- Create `apps/api/src/services/role-service.ts`
- Create `apps/api/src/routes/admin-role-routes.ts`
- Create `apps/api/src/routes/admin-permission-routes.ts`
- Modify `apps/api/src/index.ts`
- Test `apps/api/src/__tests__/role-service.test.ts`

- [ ] **Step 1: Extend `admin-schemas.ts`**

```ts
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
```

(Reuses `deleteQuerySchema`/`nameSchema` already added in Task 3.)

- [ ] **Step 2: Write failing `role-service` tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/permission-service.js", () => ({
  invalidateGroupPermissionCache: vi.fn().mockResolvedValue(undefined),
}));

describe("role-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      role: {
        create: vi.fn().mockResolvedValue({ id: "role_1", name: "Custom", isSystem: false }),
        findUnique: vi.fn(),
        delete: vi.fn().mockResolvedValue({}),
      },
      rolePermission: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
      userGroupRole: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([{ groupId: "grp_1" }, { groupId: "grp_2" }]),
      },
    };
  });

  it("rejects editing the Admin role's permissions", async () => {
    prisma.role.findUnique.mockResolvedValue({ id: "role_admin", name: "Admin", isSystem: true });
    const { setRolePermissions } = await import("../services/role-service.js");
    await expect(setRolePermissions(prisma, "role_admin", ["perm_1"])).rejects.toThrow(/Admin role/i);
  });

  it("setRolePermissions invalidates cache for every group assigned this role", async () => {
    prisma.role.findUnique.mockResolvedValue({ id: "role_1", name: "Custom", isSystem: false });
    const { setRolePermissions } = await import("../services/role-service.js");
    const { invalidateGroupPermissionCache } = await import("../services/permission-service.js");
    await setRolePermissions(prisma, "role_1", ["perm_1"]);
    expect(invalidateGroupPermissionCache).toHaveBeenCalledWith("grp_1");
    expect(invalidateGroupPermissionCache).toHaveBeenCalledWith("grp_2");
  });

  it("rejects deleting a role still assigned to a group unless force=true", async () => {
    prisma.role.findUnique.mockResolvedValue({ id: "role_1", name: "Custom", isSystem: false });
    prisma.userGroupRole.count.mockResolvedValue(1);
    const { deleteRole } = await import("../services/role-service.js");
    await expect(deleteRole(prisma, "role_1", false)).rejects.toThrow(/force/i);
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test --workspace=@repo-sentinel/api -- role-service.test.ts`

Expected before implementation: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `role-service.ts`**

```ts
import type { PrismaClient } from "@repo-sentinel/db";
import type { AdminRoleDto, CreateRoleInput, UpdateRoleInput } from "@repo-sentinel/types";
import { invalidateGroupPermissionCache } from "./permission-service.js";

function toDto(row: any): AdminRoleDto {
  return {
    id: row.id, name: row.name, description: row.description ?? null, isSystem: row.isSystem,
    permissionCount: row._count?.permissions ?? 0, groupCount: row._count?.groups ?? 0,
    permissionIds: (row.permissions ?? []).map((p: any) => p.permissionId),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
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
```

- [ ] **Step 5: Add `admin-role-routes.ts` and `admin-permission-routes.ts`**

Mirror `admin-group-routes.ts`'s shape for roles (GET/POST/PATCH/DELETE + `PUT .../permissions`), using `Resource.Roles` permissions.

```ts
// admin-permission-routes.ts
import type { FastifyInstance } from "fastify";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";

export async function registerAdminPermissionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/admin/permissions", { preHandler: [requireAuth, requirePermission(Resource.Permissions, Action.Read)] },
    async (_request, reply) => {
      const rows = await app.prisma.permission.findMany({ orderBy: [{ resource: "asc" }, { action: "asc" }] });
      reply.send({ success: true, data: rows.map((r) => ({ id: r.id, resource: r.resource, action: r.action })) });
    });
}
```

- [ ] **Step 6: Register both routes**

In `apps/api/src/index.ts`, import and register `registerAdminRoleRoutes` and `registerAdminPermissionRoutes`.

- [ ] **Step 7: Run tests and build**

```bash
npm test --workspace=@repo-sentinel/api -- admin-schemas.test.ts role-service.test.ts
npm run build --workspace=@repo-sentinel/api
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

```bash
git add apps/api/src/schemas/admin-schemas.ts apps/api/src/services/role-service.ts apps/api/src/routes/admin-role-routes.ts apps/api/src/routes/admin-permission-routes.ts apps/api/src/index.ts apps/api/src/__tests__/role-service.test.ts
git commit -m "feat: add admin role management and permission catalog routes"
```

### Task 5: Frontend Admin Users Page

**Files:**

- Create `apps/web/src/app/features/admin/admin-users/admin-users.service.ts`
- Create `apps/web/src/app/features/admin/admin-users/admin-users-page/` (`.ts`/`.html`/`.scss`)
- Create `apps/web/src/app/features/admin/admin-users/user-form-dialog/` (`.ts`/`.html`/`.scss`)

- [ ] **Step 1: Add the service**

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AdminUserDto, ApiResponse, CreateAdminUserInput, UpdateAdminUserInput } from '../../../core/models/dto';

@Injectable({ providedIn: 'root' })
export class AdminUsersService {
  private readonly http = inject(HttpClient);

  async list(): Promise<AdminUserDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AdminUserDto[]>>('/api/admin/users'));
    return res.data;
  }

  async create(input: CreateAdminUserInput): Promise<void> {
    await firstValueFrom(this.http.post('/api/admin/users', input));
  }

  async update(id: string, input: UpdateAdminUserInput): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/admin/users/${id}`, input));
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/admin/users/${id}`));
  }

  async setGroups(id: string, groupIds: string[]): Promise<void> {
    await firstValueFrom(this.http.put(`/api/admin/users/${id}/groups`, { groupIds }));
  }
}
```

- [ ] **Step 2: Build `admin-users-page`**

Mirror `repositories-page.ts`'s shape: `MatTableModule` list with columns `name/email/role badge/banned badge/groups/actions`; role/banned rendered as `.chip-success`/`.chip-error`/`.chip-neutral` spans (per `CLAUDE.md`'s shared-chip-class convention, not `MatChipsModule`). Actions: Edit (opens `UserFormDialog` with `MAT_DIALOG_DATA`), Manage Groups (a small inline `mat-selection-list` popover or a reused `UserFormDialog` groups tab — keep it simple: fold the group multi-select into `UserFormDialog` itself rather than a separate dialog, since `AdminGroupDto[]` is small), Ban/Unban toggle, Delete (disabled for the current logged-in user — compare against `AuthService.user()!.id`).

- [ ] **Step 3: Build `user-form-dialog`**

Create mode: name/email/password fields + a `mat-selection-list` of all groups (fetched via `AdminGroupsService.list()` injected here) for initial `groupIds`. Edit mode (`MAT_DIALOG_DATA` present): name/email fields (no password field — password changes are out of this feature's scope per the spec) + the same group `mat-selection-list`, calling `AdminUsersService.update()` then `.setGroups()` on save.

- [ ] **Step 4: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

```bash
git add apps/web/src/app/features/admin/admin-users
git commit -m "feat: add admin users management page"
```

### Task 6: Frontend Admin Groups Page

**Files:**

- Create `apps/web/src/app/features/admin/admin-groups/admin-groups.service.ts`
- Create `apps/web/src/app/features/admin/admin-groups/admin-groups-page/` (`.ts`/`.html`/`.scss`)
- Create `apps/web/src/app/features/admin/admin-groups/group-form-dialog/` (`.ts`/`.html`/`.scss`)
- Create `apps/web/src/app/features/admin/admin-groups/group-roles-dialog/` (`.ts`/`.html`/`.scss`)

- [ ] **Step 1: Add the service**

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AdminGroupDto, ApiResponse } from '../../../core/models/dto';

export interface GroupFormInput { name: string; description?: string }

@Injectable({ providedIn: 'root' })
export class AdminGroupsService {
  private readonly http = inject(HttpClient);

  async list(): Promise<AdminGroupDto[]> {
    const res = await firstValueFrom(this.http.get<ApiResponse<AdminGroupDto[]>>('/api/admin/groups'));
    return res.data;
  }

  async create(input: GroupFormInput): Promise<void> {
    await firstValueFrom(this.http.post('/api/admin/groups', input));
  }

  async update(id: string, input: GroupFormInput): Promise<void> {
    await firstValueFrom(this.http.patch(`/api/admin/groups/${id}`, input));
  }

  async remove(id: string, force = false): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/admin/groups/${id}${force ? '?force=true' : ''}`));
  }

  async setRoles(id: string, roleIds: string[]): Promise<void> {
    await firstValueFrom(this.http.put(`/api/admin/groups/${id}/roles`, { roleIds }));
  }
}
```

- [ ] **Step 2: Build `admin-groups-page`**

`MatTableModule` list: `name/description/memberCount/roles chips/actions`. Rename/Delete buttons `[disabled]="group.isSystem"` with a tooltip explaining why. Delete confirms via a native `confirm()` (matches this repo's existing lightweight-confirmation convention — no `MatDialog`-based confirm component exists yet elsewhere; don't introduce one for this single case) and retries with `force=true` if the first call 409s with a member-count message.

- [ ] **Step 3: Build `group-form-dialog`**

Simple name/description fields, create or edit based on `MAT_DIALOG_DATA` presence — mirrors `connection-form-dialog.ts`/`repo-config-dialog.ts` exactly.

- [ ] **Step 4: Build `group-roles-dialog`**

`MAT_DIALOG_DATA: AdminGroupDto`. Fetches all roles via `AdminRolesService.list()` (injected — this creates a light coupling to Task 7's service; if Task 7 hasn't run yet, stub the import and revisit, or implement Task 7's `AdminRolesService.list()` minimally here first). Renders a `mat-selection-list` of role names with the group's current `roleIds` pre-selected; Save calls `AdminGroupsService.setRoles(group.id, selectedIds)`.

- [ ] **Step 5: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

```bash
git add apps/web/src/app/features/admin/admin-groups
git commit -m "feat: add admin groups management page"
```

### Task 7: Frontend Admin Roles and Permissions Pages

**Files:**

- Create `apps/web/src/app/features/admin/admin-roles/admin-roles.service.ts`
- Create `apps/web/src/app/features/admin/admin-roles/admin-roles-page/` (`.ts`/`.html`/`.scss`)
- Create `apps/web/src/app/features/admin/admin-roles/role-form-dialog/` (`.ts`/`.html`/`.scss`)
- Create `apps/web/src/app/features/admin/admin-roles/role-permissions-dialog/` (`.ts`/`.html`/`.scss`)
- Create `apps/web/src/app/features/admin/admin-permissions/admin-permissions.service.ts`
- Create `apps/web/src/app/features/admin/admin-permissions/admin-permissions-page/` (`.ts`/`.html`/`.scss`)

- [ ] **Step 1: Add `AdminRolesService`**

Same shape as `AdminGroupsService` (Task 6), but for `/api/admin/roles` + `setPermissions(id, permissionIds)` → `PUT /api/admin/roles/:id/permissions`.

- [ ] **Step 2: Add `AdminPermissionsService`**

```ts
async list(): Promise<PermissionDto[]> {
  const res = await firstValueFrom(this.http.get<ApiResponse<PermissionDto[]>>('/api/admin/permissions'));
  return res.data;
}
```

- [ ] **Step 3: Build `admin-roles-page`**

Same list/rename/delete pattern as `admin-groups-page`, columns `name/description/permissionCount/groupCount/actions`. Rename/Delete disabled for `isSystem` roles.

- [ ] **Step 4: Build `role-form-dialog`**

Name/description fields, mirrors `group-form-dialog`.

- [ ] **Step 5: Build `role-permissions-dialog`**

`MAT_DIALOG_DATA: AdminRoleDto`. Fetches the full catalog via `AdminPermissionsService.list()`, groups rows by `resource` into a matrix: one row per resource, one checkbox column per `Create/Read/Update/Delete`. Pre-check boxes matching `role.permissionIds`. **The entire matrix is rendered with `[disabled]="true"` (and a banner explaining why) when `role.name === 'Admin'`** — per the spec, the Admin role's permission set can never be edited. Save calls `AdminRolesService.setPermissions(role.id, selectedIds)`.

- [ ] **Step 6: Build `admin-permissions-page`**

Read-only `MatTableModule` list grouped by resource, columns `resource/action` — no action column, no dialogs.

- [ ] **Step 7: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 8: Checkpoint**

```bash
git add apps/web/src/app/features/admin/admin-roles apps/web/src/app/features/admin/admin-permissions
git commit -m "feat: add admin roles and permission catalog pages"
```

### Task 8: Routing and Sidebar Nav

**Files:**

- Modify `apps/web/src/app/app.routes.ts`
- Modify `apps/web/src/app/layout/sidebar-nav/sidebar-nav.ts`
- Modify `apps/web/src/app/layout/sidebar-nav/sidebar-nav.html`

- [ ] **Step 1: Add the `/admin` route branch**

In `app.routes.ts`, import `adminGuard` from `./core/guards/admin.guard` and add (as a sibling of the existing `AppShell` children, itself gated by `adminGuard` at the branch level, each child additionally gated by `permissionGuard`):

```ts
{
  path: 'admin',
  canActivate: [adminGuard],
  children: [
    { path: '', redirectTo: 'users', pathMatch: 'full' },
    { path: 'users', canActivate: [permissionGuard], data: { resource: Resource.Users, action: Action.Read },
      loadComponent: () => import('./features/admin/admin-users/admin-users-page/admin-users-page').then((m) => m.AdminUsersPage) },
    { path: 'groups', canActivate: [permissionGuard], data: { resource: Resource.Groups, action: Action.Read },
      loadComponent: () => import('./features/admin/admin-groups/admin-groups-page/admin-groups-page').then((m) => m.AdminGroupsPage) },
    { path: 'roles', canActivate: [permissionGuard], data: { resource: Resource.Roles, action: Action.Read },
      loadComponent: () => import('./features/admin/admin-roles/admin-roles-page/admin-roles-page').then((m) => m.AdminRolesPage) },
    { path: 'permissions', canActivate: [permissionGuard], data: { resource: Resource.Permissions, action: Action.Read },
      loadComponent: () => import('./features/admin/admin-permissions/admin-permissions-page/admin-permissions-page').then((m) => m.AdminPermissionsPage) },
  ],
},
```

Place this branch as a child of the same parent `AppShell`-wrapped route as `settings`, not a sibling top-level route, so it shares the authenticated shell/sidebar.

- [ ] **Step 2: Add the Admin nav section**

In `sidebar-nav.ts`, add a second array (or extend `NavItem` with an optional `adminOnly` flag) for the four admin links, rendered only when `this.isAdmin()`:

```ts
const ADMIN_NAV_ITEMS: NavItem[] = [
  { path: '/admin/users', label: 'Users', icon: 'group', resource: Resource.Users },
  { path: '/admin/groups', label: 'Groups', icon: 'groups', resource: Resource.Groups },
  { path: '/admin/roles', label: 'Roles', icon: 'admin_panel_settings', resource: Resource.Roles },
  { path: '/admin/permissions', label: 'Permissions', icon: 'key', resource: Resource.Permissions },
];
```

```ts
readonly adminItems = computed(() => (this.isAdmin() ? ADMIN_NAV_ITEMS : []));
```

In `sidebar-nav.html`, render `adminItems()` as a second `mat-nav-list` section below the existing one, with a small "Admin" section header, following the existing `mat-list-item`/`routerLink`/`routerLinkActive` markup.

- [ ] **Step 3: Run web build**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 4: Checkpoint**

```bash
git add apps/web/src/app/app.routes.ts apps/web/src/app/layout/sidebar-nav
git commit -m "feat: wire up /admin routes and sidebar nav section"
```

### Task 9: Final Verification

**Files:** no planned edits unless verification finds issues.

- [ ] **Step 1: Run API tests**

Run: `npm test --workspace=@repo-sentinel/api`

Expected: PASS (all suites, including the four new ones from Tasks 2-4).

- [ ] **Step 2: Build API**

Run: `npm run build --workspace=@repo-sentinel/api`

Expected: PASS.

- [ ] **Step 3: Build web**

Run: `npm run build --workspace=@repo-sentinel/web`

Expected: PASS.

- [ ] **Step 4: Run full workspace build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: Manual smoke test**

Start API/web via the repo's normal dev workflow, sign in as the seeded Admin (`ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD`), then:

1. Confirm the sidebar shows an "Admin" section (Users/Groups/Roles/Permissions) — sign in as a non-admin user and confirm it does NOT appear.
2. Users page: create a user, assign them to a custom group, confirm they can sign in and see only that group's permissions; ban them and confirm sign-in is rejected; attempt to delete your own account and confirm it's blocked.
3. Groups page: create a custom group, assign it the `Reviewer` role, confirm a user in that group gets Reviewer-level access; attempt to rename/delete the `Admin`/`Reviewer`/`Viewer` system groups and confirm both are blocked.
4. Roles page: create a custom role, assign a subset of permissions, assign the role to a group, confirm the effect; attempt to edit the `Admin` role's permissions and confirm it's blocked; attempt to delete a role still assigned to a group and confirm the `force=true` confirmation flow works.
5. Permissions page: confirm it renders the full `Resource × Action` catalog read-only.
6. Confirm removing the last member of the `Admin` group (including attempting to remove yourself if you're the only admin) is blocked with a clear error.

- [ ] **Step 6: Final checkpoint**

```bash
git status --short
git commit -m "feat: complete Admin RBAC management UI"
```

Only run the final commit if there are remaining staged changes not covered by earlier checkpoints.

## Self-Review

Spec coverage:

- Shared DTOs: Task 1.
- User CRUD + group assignment + admin-flag sync: Task 2.
- Group CRUD + role assignment: Task 3.
- Role CRUD + permission assignment + permission catalog: Task 4.
- Frontend Users/Groups/Roles/Permissions pages: Tasks 5-7.
- Routing + sidebar gating: Task 8.
- Full verification + manual smoke test: Task 9.

Placeholder scan:

- No placeholder implementations left in executable steps. The `banExpiresInSeconds` vs. `banExpires` naming mismatch between the spec's DB-column wording and better-auth's actual duration-based API is called out explicitly up front (in the plan header) and carried consistently through Task 1's DTO, Task 2's schema/service/route, so no task silently reintroduces the wrong shape.
- Task 6 Step 4 (`group-roles-dialog`) notes a soft cross-task dependency on `AdminRolesService.list()` (built in Task 7) — flagged explicitly with a fallback instruction (stub/minimal-implement-then-revisit) rather than left implicit, since Task 6 is listed before Task 7.

Type consistency:

- `AdminUserDto`/`AdminGroupDto`/`AdminRoleDto`/`PermissionDto` are defined once in Task 1 before any service/route/frontend task references them.
- Route → service → frontend-service naming is consistent end-to-end (e.g. `setUserGroups`/`setGroupRoles`/`setRolePermissions` used identically in their respective service and route tasks).
- `requirePermission(Resource.X, Action.Y)` usage in every new route matches the exact `Resource`/`Action` values already present in `packages/types/src/enums.ts` — no new enum values needed anywhere in this plan.
