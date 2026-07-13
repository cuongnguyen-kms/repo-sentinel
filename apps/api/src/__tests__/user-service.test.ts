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
      $transaction: vi.fn(async (ops: any) => Promise.all(ops)),
    };
  });

  it("createUser calls auth.api.createUser then assigns groups", async () => {
    const { createUser } = await import("../services/user-service.js");
    const { auth } = await import("../lib/auth.js");
    await createUser(auth as any, prisma, {} as Headers, {
      name: "New",
      email: "new@co.com",
      password: "longenough1",
      groupIds: ["grp_1"],
    });
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
