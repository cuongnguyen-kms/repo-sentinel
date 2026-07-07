import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo-sentinel/ghe-client", () => ({
  GheClient: vi.fn().mockImplementation(() => ({
    createReviewComment: vi.fn().mockResolvedValue({ id: 123, html_url: "https://ghe/comment/123" }),
    getReviewComment: vi.fn().mockResolvedValue({ id: 123, html_url: "https://ghe/comment/123" }),
    deleteReviewComment: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock("../services/encryption-service.js", () => ({ decrypt: vi.fn(() => "plain-token") }));

describe("github-comment-service", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      pullRequest: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          ghePrId: 7,
          headCommitSha: "head-sha",
          repo: { owner: "acme", name: "app", connection: { hostname: "ghe.local", token: "encrypted" } },
        }),
      },
      aiReview: {
        findFirst: vi.fn().mockResolvedValue({ id: "review_1", commitSha: "review-sha" }),
      },
      postedFindingComment: {
        upsert: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
      },
    };
  });

  it("posts a single finding and persists the GitHub comment", async () => {
    const { postSingleComment } = await import("../services/github-comment-service.js");
    const result = await postSingleComment(prisma, "pr_1", {
      findingId: "F1",
      path: "src/app.ts",
      line: 10,
      body: "Review comment",
      reviewId: "review_1",
    });

    expect(result).toEqual({ id: 123, html_url: "https://ghe/comment/123" });
    expect(prisma.postedFindingComment.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { reviewId_findingId: { reviewId: "review_1", findingId: "F1" } },
    }));
  });
});
