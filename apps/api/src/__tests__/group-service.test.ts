import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/permission-service.js", () => ({
  invalidateGroupPermissionCache: vi.fn().mockResolvedValue(undefined),
}));

describe("group-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      userGroup: {
        create: vi.fn().mockResolvedValue({ id: "grp_1", name: "Custom", isSystem: false, description: null, createdAt: new Date(), updatedAt: new Date() }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
      },
      userGroupMembership: { count: vi.fn().mockResolvedValue(0) },
      userGroupRole: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (ops: any) => Promise.all(ops)),
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
