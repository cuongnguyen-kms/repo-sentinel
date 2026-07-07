import { describe, expect, it, vi } from "vitest";

describe("review-comparison-service", () => {
  it("reports new and carried-over findings", async () => {
    const previousJson = JSON.stringify({
      findings: [{ id: "F1", file: "src/a.ts", line: 1, severity: "high", title: "Bug", comment: "Bug" }],
    });
    const currentJson = JSON.stringify({
      findings: [
        { id: "F1", file: "src/a.ts", line: 1, severity: "high", title: "Bug", comment: "Bug" },
        { id: "F2", file: "src/b.ts", line: 2, severity: "medium", title: "New", comment: "New" },
      ],
    });
    const prisma: any = {
      aiReview: {
        findUnique: vi.fn().mockResolvedValue({
          id: "current",
          pullRequestId: "pr_1",
          codeReviewJson: currentJson,
          createdAt: new Date("2026-07-07T01:00:00Z"),
          commitSha: "sha2",
          openCommentsSnapshot: null,
        }),
        findFirst: vi.fn().mockResolvedValue({ id: "previous", codeReviewJson: previousJson }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      postedFindingComment: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { computeReviewComparison } = await import("../services/review-comparison-service.js");
    const result = await computeReviewComparison(prisma, "current");
    expect(result.newCount).toBe(1);
    expect(result.carriedOverCount).toBe(1);
  });
});
