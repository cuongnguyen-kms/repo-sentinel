import { describe, expect, it } from "vitest";
import {
  createAdminUserSchema,
  createGroupSchema,
  createRoleSchema,
  setUserGroupsBodySchema,
  updateAdminUserSchema,
} from "../schemas/admin-schemas.js";

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

describe("admin-schemas (groups/roles)", () => {
  it("rejects reserved system names for new groups", () => {
    expect(createGroupSchema.safeParse({ name: "Admin" }).success).toBe(false);
    expect(createGroupSchema.safeParse({ name: "Custom Group" }).success).toBe(true);
  });

  it("rejects reserved system names for new roles", () => {
    expect(createRoleSchema.safeParse({ name: "Reviewer" }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: "Custom Role" }).success).toBe(true);
  });
});
