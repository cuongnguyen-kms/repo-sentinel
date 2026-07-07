/**
 * Zod schemas for pull-request route request validation.
 */

import { z } from "zod";
import { PrState, ReviewStatus } from "@repo-sentinel/types";

/** GET /api/pull-requests — query params */
export const listPullRequestsQuerySchema = z.object({
  repoId: z.string().optional(),
  state: z.union([z.nativeEnum(PrState), z.literal("DRAFT")]).optional(),
  author: z.string().optional(),
  reviewStatus: z.nativeEnum(ReviewStatus).optional(),
  sort: z
    .enum(["createdAtGhe", "updatedAtGhe", "additions", "deletions"])
    .default("createdAtGhe"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Route param containing a pull-request id */
export const prIdParamSchema = z.object({
  id: z.string().min(1, "PR ID is required"),
});

export type ListPullRequestsQuery = z.infer<typeof listPullRequestsQuerySchema>;
export type PrIdParam = z.infer<typeof prIdParamSchema>;
