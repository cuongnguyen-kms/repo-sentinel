/**
 * Zod schemas for AI review route request/response validation.
 */

import { z } from "zod";

/** Route param containing a pull-request id */
export const reviewPrIdParamSchema = z.object({
  id: z.string().min(1, "PR ID is required"),
});

export type ReviewPrIdParam = z.infer<typeof reviewPrIdParamSchema>;

/** Route param containing a review id (for /api/reviews/:id/...) */
export const reviewIdParamSchema = z.object({
  id: z.string().min(1, "Review ID is required"),
});

export type ReviewIdParam = z.infer<typeof reviewIdParamSchema>;

/** Query params for paginated review history */
export const reviewHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ReviewHistoryQuery = z.infer<typeof reviewHistoryQuerySchema>;

/** Body for posting a single finding as a GitHub review comment */
export const postCommentBodySchema = z.object({
  findingId: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  body: z.string().min(1),
  subjectType: z.enum(["file"]).optional(),
  reviewId: z.string().min(1).optional(),
});

export type PostCommentBody = z.infer<typeof postCommentBodySchema>;

/** Body for submitting selected findings as a single GitHub PR review */
export const submitReviewBodySchema = z.object({
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).default("COMMENT"),
  body: z.string().optional(),
  findings: z
    .array(
      z.object({
        findingId: z.string().min(1),
        path: z.string().min(1),
        line: z.number().int().positive(),
        endLine: z.number().int().positive().optional(),
        body: z.string().min(1),
      })
    )
    .min(1, "At least one finding is required"),
});

export type SubmitReviewBody = z.infer<typeof submitReviewBodySchema>;

/** Optional reviewId query param used to scope lookups to a specific review */
export const reviewIdQuerySchema = z.object({
  reviewId: z.string().min(1).optional(),
});

export type ReviewIdQuery = z.infer<typeof reviewIdQuerySchema>;

/** Route params for a per-finding action, with a strict findingId shape to block path traversal */
export const resolveFindingParamSchema = z.object({
  id: z.string().min(1),
  findingId: z.string().min(1).max(128).regex(/^[\w\-.]+$/),
});

export type ResolveFindingParam = z.infer<typeof resolveFindingParamSchema>;

/** Body for manually resolving a finding */
export const resolveFindingBodySchema = z.object({
  reason: z.enum(["MANUAL", "WONT_FIX"]).default("MANUAL"),
  reviewId: z.string().min(1).optional(),
});

export type ResolveFindingBody = z.infer<typeof resolveFindingBodySchema>;

/** Body for resolving GitHub review threads for a batch of findings */
export const resolveGithubThreadsBodySchema = z.object({
  findingIds: z.array(z.string().min(1)).min(1),
  reviewId: z.string().min(1).optional(),
});

export type ResolveGithubThreadsBody = z.infer<typeof resolveGithubThreadsBodySchema>;
