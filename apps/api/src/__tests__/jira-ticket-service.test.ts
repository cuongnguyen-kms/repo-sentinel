import { describe, expect, it, vi } from "vitest";
import { extractTicketKeys, resolveTicketKeysForPr } from "../services/jira-ticket-service.js";

describe("jira-ticket-service", () => {
  const pattern = "[A-Z][A-Z0-9]+-\\d+";

  it("extracts ticket keys across title, body, and branch", () => {
    expect(extractTicketKeys("Fix PROJ-123 bug", "See also OPS-9", "feature/PROJ-123-fix", pattern))
      .toEqual(expect.arrayContaining(["PROJ-123", "OPS-9"]));
  });

  it("dedupes repeated keys", () => {
    expect(extractTicketKeys("PROJ-123 PROJ-123", null, "PROJ-123", pattern)).toEqual(["PROJ-123"]);
  });

  it("prefers the manual override over auto-detection", async () => {
    const prisma: any = { appSetting: { findUnique: vi.fn().mockResolvedValue(null) } };
    const keys = await resolveTicketKeysForPr(prisma, {
      jiraTicketKeyOverride: "OVR-1", title: "PROJ-123", body: null, headRef: "main",
    });
    expect(keys).toEqual(["OVR-1"]);
  });

  it("falls back to auto-detect and reads the pattern from settings", async () => {
    const prisma: any = { appSetting: { findUnique: vi.fn().mockResolvedValue({ value: pattern }) } };
    const keys = await resolveTicketKeysForPr(prisma, {
      jiraTicketKeyOverride: null, title: "PROJ-123 fix", body: null, headRef: "main",
    });
    expect(keys).toEqual(["PROJ-123"]);
  });
});
