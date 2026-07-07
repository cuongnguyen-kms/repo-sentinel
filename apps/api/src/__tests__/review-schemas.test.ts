import { describe, expect, it } from "vitest";
import {
  postCommentBodySchema,
  resolveFindingBodySchema,
  resolveFindingParamSchema,
  resolveGithubThreadsBodySchema,
} from "../schemas/review-schemas.js";

describe("review route schemas", () => {
  it("accepts a single inline comment payload", () => {
    expect(
      postCommentBodySchema.safeParse({
        findingId: "F1",
        path: "src/app.ts",
        line: 12,
        body: "Finding body",
        reviewId: "review_1",
      }).success
    ).toBe(true);
  });

  it("rejects unsafe finding ids in route params", () => {
    expect(
      resolveFindingParamSchema.safeParse({
        id: "pr_1",
        findingId: "../bad",
      }).success
    ).toBe(false);
  });

  it("accepts manual and WONT_FIX resolutions only", () => {
    expect(resolveFindingBodySchema.safeParse({ reason: "MANUAL" }).success).toBe(true);
    expect(resolveFindingBodySchema.safeParse({ reason: "WONT_FIX" }).success).toBe(true);
    expect(resolveFindingBodySchema.safeParse({ reason: "CODE_FIX" }).success).toBe(false);
  });

  it("requires at least one finding id when resolving GitHub threads", () => {
    expect(resolveGithubThreadsBodySchema.safeParse({ findingIds: [] }).success).toBe(false);
    expect(resolveGithubThreadsBodySchema.safeParse({ findingIds: ["F1"] }).success).toBe(true);
  });
});
