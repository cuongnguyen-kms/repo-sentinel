import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/hostname-validation.js", () => ({
  validateAtlassianHostname: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/atlassian-api-client-service.js", () => ({
  fetchCurrentUser: vi.fn().mockResolvedValue({ accountId: "acc_1", displayName: "Bot", emailAddress: "bot@co.com" }),
}));
vi.mock("../services/encryption-service.js", () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace(/^enc:/, "")),
}));

describe("atlassian-connection-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      atlassianConnection: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({
          id: "conn_1", ...data, createdAt: new Date(), updatedAt: new Date(),
        })),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
  });

  it("replaces the singleton connection by creating when none exists", async () => {
    const { replaceConnection } = await import("../services/atlassian-connection-service.js");
    const dto = await replaceConnection(prisma, { hostname: "acme.atlassian.net", email: "a@acme.com", apiToken: "tok" });
    expect(dto.hostname).toBe("acme.atlassian.net");
    expect(prisma.atlassianConnection.create).toHaveBeenCalled();
    expect((dto as any).apiToken).toBeUndefined();
  });

  it("replaces the singleton connection by updating when one already exists", async () => {
    prisma.atlassianConnection.findFirst.mockResolvedValue({
      id: "conn_1", hostname: "old.atlassian.net", email: "old@acme.com", apiToken: "enc:old", createdAt: new Date(), updatedAt: new Date(),
    });
    prisma.atlassianConnection.update.mockResolvedValue({
      id: "conn_1", hostname: "acme.atlassian.net", email: "a@acme.com", apiToken: "enc:tok", createdAt: new Date(), updatedAt: new Date(),
    });
    const { replaceConnection } = await import("../services/atlassian-connection-service.js");
    await replaceConnection(prisma, { hostname: "acme.atlassian.net", email: "a@acme.com", apiToken: "tok" });
    expect(prisma.atlassianConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "conn_1" } }));
    expect(prisma.atlassianConnection.create).not.toHaveBeenCalled();
  });

  it("testConnection reports failure when no connection is configured", async () => {
    const { testConnection } = await import("../services/atlassian-connection-service.js");
    const result = await testConnection(prisma);
    expect(result).toEqual({ success: false, message: "No Atlassian connection configured" });
  });
});
