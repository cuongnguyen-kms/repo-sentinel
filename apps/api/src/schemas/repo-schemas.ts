/**
 * Zod schemas for repository management route request validation.
 */

import { z } from "zod";

/** POST /api/repos/watch — body */
export const watchReposSchema = z.object({
  connectionId: z.string().min(1, "connectionId is required"),
  repos: z
    .array(
      z.object({
        owner: z.string().min(1),
        name: z.string().min(1),
        fullName: z.string().min(1),
      })
    )
    .min(1, "At least one repo required"),
});

/** PATCH /api/repos/:id — body */
export const updateRepoSchema = z.object({
  pollingInterval: z.number().int().min(60).max(1800).optional(),
  isActive: z.boolean().optional(),
  promptTemplate: z.string().nullable().optional(),
  systemPromptTemplate: z.string().nullable().optional(),
});

/** GET /api/connections/:connId/repos — query params */
export const browseReposQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  search: z.string().optional(),
});

/** POST /api/repos/:id/poll — optional body */
export const triggerPollSchema = z.object({
  force: z.boolean().optional(),
});

/** Route param containing a repo id */
export const repoIdParamSchema = z.object({
  id: z.string().min(1, "Repo ID is required"),
});

/** Route param containing a connection id */
export const connIdParamSchema = z.object({
  connId: z.string().min(1, "Connection ID is required"),
});

export type WatchReposInput = z.infer<typeof watchReposSchema>;
export type UpdateRepoInput = z.infer<typeof updateRepoSchema>;
export type BrowseReposQuery = z.infer<typeof browseReposQuerySchema>;
export type RepoIdParam = z.infer<typeof repoIdParamSchema>;
export type ConnIdParam = z.infer<typeof connIdParamSchema>;
