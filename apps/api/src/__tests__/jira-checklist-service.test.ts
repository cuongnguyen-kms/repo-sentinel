import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../services/atlassian-connection-service.js", () => ({
  getDecryptedConnection: vi.fn().mockResolvedValue({ hostname: "acme.atlassian.net", email: "a@acme.com", apiToken: "tok" }),
}));
vi.mock("../services/jira-ticket-service.js", () => ({
  fetchJiraTicket: vi.fn().mockResolvedValue({
    key: "PROJ-1", summary: "Do the thing", description: "Must return 200", status: "In Progress",
    url: "https://acme.atlassian.net/browse/PROJ-1", updated: "2026-07-08T00:00:00Z",
  }),
}));
vi.mock("../services/settings-service.js", () => ({
  getSetting: vi.fn().mockResolvedValue(""),
}));

function fakeSpawnedProcess(stdout: string, exitCode = 0) {
  const child: any = new EventEmitter();
  child.stdin = { end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Emit asynchronously so listeners attached right after spawn() still catch these events.
  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(stdout));
    child.emit("close", exitCode);
  });
  return child;
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => fakeSpawnedProcess("- [ ] Returns 200")),
}));

describe("jira-checklist-service", () => {
  it("persists a generated checklist row", async () => {
    const prisma: any = {
      jiraChecklist: {
        upsert: vi.fn().mockResolvedValue({
          ticketKey: "PROJ-1", content: "- [ ] Returns 200", generatedAt: new Date(), updatedAt: new Date(),
        }),
      },
    };
    const { generateChecklist } = await import("../services/jira-checklist-service.js");
    const result = await generateChecklist(prisma, "proj-1");
    expect(result.ticketKey).toBe("PROJ-1");
    expect(prisma.jiraChecklist.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ticketKey: "PROJ-1" },
    }));
  });

  it("flags staleness when the ticket updated after generation", async () => {
    const prisma: any = {
      jiraChecklist: {
        findUnique: vi.fn().mockResolvedValue({
          ticketKey: "PROJ-1", content: "x", generatedAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
        }),
      },
    };
    const { getChecklist } = await import("../services/jira-checklist-service.js");
    const result = await getChecklist(prisma, "PROJ-1");
    expect(result?.stale).toBe(true);
  });

  it("returns null when no checklist exists", async () => {
    const prisma: any = { jiraChecklist: { findUnique: vi.fn().mockResolvedValue(null) } };
    const { getChecklist } = await import("../services/jira-checklist-service.js");
    expect(await getChecklist(prisma, "NOPE-1")).toBeNull();
  });
});
