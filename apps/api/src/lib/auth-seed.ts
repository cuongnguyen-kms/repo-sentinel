/**
 * Seeds the database with initial auth data:
 * - All resource:action permissions (11 resources x 4 actions = 44)
 * - Three system roles: Admin (all), Reviewer (limited), Viewer (read-only)
 * - Three system groups assigned corresponding roles
 *
 * Idempotent: uses upsert; safe to run multiple times.
 */
import { prisma } from "@repo-sentinel/db";
import { Resource, Action } from "@repo-sentinel/types";
import { auth } from "./auth.js";

const RESOURCES = Object.values(Resource);

const ACTIONS = Object.values(Action);

const ALL_PERMISSIONS = RESOURCES.flatMap((r) =>
  ACTIONS.map((a) => ({ resource: r, action: a }))
);

type RoleDef = { description: string; permissions: string[] | "*"; isSystem: true };

const ROLE_DEFS: Record<string, RoleDef> = {
  Admin: { description: "Full access to all resources", permissions: "*", isSystem: true },
  Reviewer: {
    description: "Review PRs, manage AI reviews",
    isSystem: true,
    permissions: [
      `${Resource.Reviews}:${Action.Create}`, `${Resource.Reviews}:${Action.Read}`, `${Resource.Reviews}:${Action.Update}`,
      `${Resource.PullRequests}:${Action.Read}`, `${Resource.Repos}:${Action.Read}`, `${Resource.Dashboard}:${Action.Read}`,
      `${Resource.Notifications}:${Action.Read}`, `${Resource.Notifications}:${Action.Update}`,
    ],
  },
  Viewer: {
    description: "Read-only access",
    isSystem: true,
    permissions: [
      `${Resource.PullRequests}:${Action.Read}`, `${Resource.Repos}:${Action.Read}`, `${Resource.Reviews}:${Action.Read}`,
      `${Resource.Dashboard}:${Action.Read}`,
      `${Resource.Notifications}:${Action.Read}`, `${Resource.Notifications}:${Action.Update}`,
    ],
  },
};

// Each system group gets the role of the same name
const GROUP_ROLE_ASSIGNMENTS: Record<string, string> = {
  Admin: "Admin",
  Reviewer: "Reviewer",
  Viewer: "Viewer",
};

const GROUP_DESCRIPTIONS: Record<string, string> = {
  Admin: "Full access to all resources",
  Reviewer: "Review PRs, manage AI reviews",
  Viewer: "Read-only access",
};

export async function seedAuthData(): Promise<void> {
  // 1. Seed all permissions
  for (const { resource, action } of ALL_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { resource_action: { resource, action } },
      update: {},
      create: { resource, action },
    });
  }

  // 2. Seed system roles with permissions
  const allPerms = await prisma.permission.findMany();
  for (const [name, def] of Object.entries(ROLE_DEFS)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: def.description, isSystem: true },
    });

    const permsForRole = def.permissions === "*"
      ? allPerms
      : allPerms.filter((p) =>
          (def.permissions as string[]).includes(`${p.resource}:${p.action}`)
        );

    for (const perm of permsForRole) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // 3. Seed system groups and assign corresponding roles
  for (const [groupName, roleName] of Object.entries(GROUP_ROLE_ASSIGNMENTS)) {
    const group = await prisma.userGroup.upsert({
      where: { name: groupName },
      update: {},
      create: { name: groupName, description: GROUP_DESCRIPTIONS[groupName], isSystem: true },
    });

    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) continue;

    await prisma.userGroupRole.upsert({
      where: { groupId_roleId: { groupId: group.id, roleId: role.id } },
      update: {},
      create: { groupId: group.id, roleId: role.id },
    });
  }

  // 4. Bootstrap admin user from env vars (skips if an admin already exists)
  await seedAdminUser();
}

async function seedAdminUser(): Promise<void> {
  const adminEmail = process.env["ADMIN_SEED_EMAIL"];
  const adminPassword = process.env["ADMIN_SEED_PASSWORD"];

  if (!adminEmail || !adminPassword) return;

  // Warn if seed password is weak (min 12 chars, requires digit + symbol)
  const isWeak = adminPassword.length < 12 || !/\d/.test(adminPassword) || !/[^a-zA-Z0-9]/.test(adminPassword);
  if (isWeak) {
    console.warn("[auth-seed] ADMIN_SEED_PASSWORD is weak — use at least 12 chars with a digit and symbol. Rotate after first login.");
  }

  // Skip if any member is already in the Admin group
  const adminGroup = await prisma.userGroup.findUnique({ where: { name: "Admin" } });
  if (!adminGroup) return;

  const existingAdmin = await prisma.userGroupMembership.findFirst({
    where: { groupId: adminGroup.id },
  });
  if (existingAdmin) return;

  // Create the admin user via better-auth
  const result = await auth.api.signUpEmail({
    body: { email: adminEmail, password: adminPassword, name: "Admin" },
  });

  if (!result?.user) return;

  // Add user to Admin group
  await prisma.userGroupMembership.create({
    data: { groupId: adminGroup.id, userId: result.user.id },
  });

  // Set the better-auth role to 'admin' so frontend AdminGuard allows access to /admin/* routes
  await prisma.user.update({
    where: { id: result.user.id },
    data: { role: "admin" },
  });
}
