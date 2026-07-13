import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/permission-service.js", () => ({
  invalidateGroupPermissionCache: vi.fn().mockResolvedValue(undefined),
}));

describe("role-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      role: {
        create: vi.fn().mockResolvedValue({ id: "role_1", name: "Custom", isSystem: false, description: null, createdAt: new Date(), updatedAt: new Date() }),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      rolePermission: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
      userGroupRole: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([{ groupId: "grp_1" }, { groupId: "grp_2" }]),
      },
      $transaction: vi.fn(async (ops: any) => Promise.all(ops)),
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
