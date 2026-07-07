import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/encryption-service.js", () => ({ decrypt: vi.fn(() => "plain-token") }));

describe("github-reply-sync-service", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stores dismissal replies and marks finding WONT_FIX", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "" },
        json: async () => [
          { id: 123, body: "[RepoSentinel] finding", html_url: "https://ghe/c/123", user: { login: "bot" } },
          {
            id: 124,
            in_reply_to_id: 123,
            body: "false positive",
            html_url: "https://ghe/c/124",
            user: { login: "dev" },
            created_at: "2026-07-07T00:00:00Z",
          },
        ],
      })
    );
    const prisma: any = {
      aiReview: {
        findUnique: vi.fn().mockResolvedValue({
          pullRequest: {
            ghePrId: 5,
            repo: { owner: "acme", name: "app", connection: { hostname: "github.com", token: "enc" } },
          },
        }),
      },
      appSetting: { findUnique: vi.fn().mockResolvedValue({ value: "false positive" }) },
      postedFindingComment: {
        findMany: vi.fn().mockResolvedValue([
          { id: "pfc_1", githubCommentId: "123", githubHtmlUrl: "https://ghe/c/123", replyCount: 0 },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      findingReply: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const { syncRepliesForReview } = await import("../services/github-reply-sync-service.js");
    const result = await syncRepliesForReview(prisma, "review_1");
    expect(result.dismissed).toBe(1);
    expect(prisma.findingReply.upsert).toHaveBeenCalled();
  });
});
