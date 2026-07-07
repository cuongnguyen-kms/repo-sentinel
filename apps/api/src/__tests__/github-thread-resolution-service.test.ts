import { describe, expect, it, vi } from "vitest";

vi.mock("@repo-sentinel/ghe-client", () => ({
  GheClient: vi.fn().mockImplementation(() => ({
    listReviewThreads: vi.fn().mockResolvedValue([
      { threadNodeId: "thread_1", isResolved: false, firstCommentDatabaseId: 123 },
    ]),
    resolveReviewThread: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("../services/encryption-service.js", () => ({ decrypt: vi.fn(() => "plain-token") }));

describe("github-thread-resolution-service", () => {
  it("resolves matching unresolved GitHub threads", async () => {
    const prisma: any = {
      aiReview: { findFirst: vi.fn().mockResolvedValue({ id: "review_1" }) },
      postedFindingComment: {
        findMany: vi.fn().mockResolvedValue([{ findingId: "F1", githubCommentId: "123" }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      pullRequest: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ghePrId: 5,
          repo: { owner: "acme", name: "app", connection: { hostname: "ghe.local", token: "enc" } },
        }),
      },
    };
    const { resolveGithubThreads } = await import("../services/github-thread-resolution-service.js");
    await expect(resolveGithubThreads(prisma, "pr_1", ["F1"], "review_1"))
      .resolves.toMatchObject({ resolved: 1, failed: 0, skipped: 0 });
  });
});
