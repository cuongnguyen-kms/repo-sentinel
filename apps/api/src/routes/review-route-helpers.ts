/** Shared helpers for AI review route modules. */

export { ServiceError } from "../utils/service-error.js";

import type { FastifyReply } from "fastify";
import type { AiReview } from "@prisma/client";
import type { FindingsBreakdown } from "@repo-sentinel/types";
import { ZodError } from "zod";

export function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({
    success: false,
    error: "Validation failed",
    details: err.flatten().fieldErrors,
  });
}

export type AiReviewWithCount = AiReview & {
  _count?: { postedComments: number };
};

/**
 * Enrich an AiReview DB record into the AiReviewDto wire format.
 * Adds postedCommentsCount and findingsCount derived fields.
 *
 * findingsCount is always derived from codeReviewJson.findings.length so the
 * header chip is consistent with the findings shown in the content — falls
 * back to the DB column only when JSON is absent.
 */
export function enrichReviewDto(review: AiReviewWithCount) {
  let findingsCount: number | undefined = review.findingsCount ?? undefined;
  let findingsBreakdown: FindingsBreakdown | undefined;
  if (review.codeReviewJson) {
    try {
      const parsed = JSON.parse(review.codeReviewJson) as { findings?: { severity?: string }[] };
      if (parsed.findings) {
        findingsCount = parsed.findings.length;
        const bd: Record<string, number> = {};
        for (const f of parsed.findings) {
          const sev = f.severity?.toLowerCase();
          if (sev) bd[sev] = (bd[sev] ?? 0) + 1;
        }
        findingsBreakdown = bd as FindingsBreakdown;
      }
    } catch {
      // ignore parse errors — retain DB column value
    }
  }
  const { _count, ...rest } = review;
  return {
    ...rest,
    startedAt: review.startedAt?.toISOString() ?? null,
    completedAt: review.completedAt?.toISOString() ?? null,
    createdAt: review.createdAt.toISOString(),
    postedCommentsCount: _count?.postedComments ?? 0,
    findingsCount,
    findingsBreakdown,
  };
}
