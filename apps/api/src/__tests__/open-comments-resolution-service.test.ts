import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { OPEN_COMMENTS_FILENAME } from "../services/open-comments-writer-service.js";

describe("open-comments-resolution-service", () => {
  it("applies resolved entries and carries still-open entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-comments-"));
    await writeFile(
      join(dir, OPEN_COMMENTS_FILENAME),
      JSON.stringify([
        {
          commentId: "pfc_1",
          findingId: "F1",
          title: "Bug",
          file: "src/a.ts",
          line: 10,
          severity: "high",
          comment: "Bug",
          status: "OPEN",
          resolution: "RESOLVED",
          resolutionReason: "CODE_FIX",
        },
        {
          commentId: "pfc_2",
          findingId: "F2",
          title: "Still",
          file: "src/b.ts",
          line: 20,
          severity: "medium",
          comment: "Still",
          status: "OPEN",
          resolution: "STILL_OPEN",
          resolutionReason: null,
        },
      ])
    );
    const prisma: any = {
      postedFindingComment: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          id: "pfc_2",
          reviewId: "old_review",
          findingId: "F2",
          githubCommentId: "222",
          githubHtmlUrl: "https://ghe/c/222",
          postedAt: new Date(),
          deletedOnGithub: false,
          resolutionStatus: "OPEN",
        }),
        delete: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({}),
      },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    };
    const { applyOpenCommentResolutions } = await import("../services/open-comments-resolution-service.js");
    const result = await applyOpenCommentResolutions(prisma, dir, "new-sha", { reviewId: "new_review", findings: [] });
    expect(result).toMatchObject({ resolved: 1, stillOpen: 1, carriedOver: 1 });
  });
});
