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
