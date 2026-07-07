/**
 * Business logic for watched repository management.
 * Handles browsing GHE repos, watch/unwatch, list, and config updates.
 * Tokens are NEVER returned in any output.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import { GheClient } from "@repo-sentinel/ghe-client";
import type { WatchedRepoDto } from "@repo-sentinel/types";
import { decrypt } from "./encryption-service.js";
import type { WatchReposInput, UpdateRepoInput } from "../schemas/repo-schemas.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toDto(
  row: {
    id: string;
    connectionId: string;
    owner: string;
    name: string;
    fullName: string;
    pollingInterval: number;
    lastPolledAt: Date | null;
    lastPollStatus: string | null;
    isActive: boolean;
    createdAt: Date;
    promptTemplate: string | null;
    systemPromptTemplate: string | null;
  }
): WatchedRepoDto {
  const status: WatchedRepoDto["status"] = !row.isActive
    ? "paused"
    : row.lastPollStatus === "error"
    ? "error"
    : "active";

  return {
    id: row.id,
    connectionId: row.connectionId,
    owner: row.owner,
    name: row.name,
    fullName: row.fullName,
    pollingInterval: row.pollingInterval,
    lastPolledAt: row.lastPolledAt ? row.lastPolledAt.toISOString() : null,
    isActive: row.isActive,
    status,
    createdAt: row.createdAt.toISOString(),
    promptTemplate: row.promptTemplate ?? null,
    systemPromptTemplate: row.systemPromptTemplate ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Browse repositories available on a GHE connection.
 * Decrypts the token server-side; never returns it.
 */
const GHE_PAGE_SIZE = 30;

export async function browseGheRepos(
  prisma: PrismaClient,
  connectionId: string,
  page: number,
  search?: string
): Promise<{ repos: Array<{ id: number; name: string; fullName: string; owner: string; private: boolean; description: string | null; updatedAt: string }>; page: number; hasMore: boolean }> {
  const connection = await prisma.gheConnection.findUnique({
    where: { id: connectionId },
    select: { hostname: true, token: true },
  });
  if (!connection) {
    throw new Error("Connection not found");
  }

  const token = decrypt(connection.token);
  const client = new GheClient(connection.hostname, token);

  const [gheRepos, watchedRepos] = await Promise.all([
    search
      ? client.searchRepos(search, page, GHE_PAGE_SIZE)
      : client.listRepos(page, GHE_PAGE_SIZE),
    prisma.watchedRepo.findMany({
      where: { connectionId },
      select: { fullName: true },
    }),
  ]);

  // hasMore is based on raw GHE count — tells the frontend whether a next page exists
  // even if all items on this page are filtered out as already-watched.
  const hasMore = gheRepos.length >= GHE_PAGE_SIZE;

  const watchedSet = new Set(watchedRepos.map((r) => r.fullName));
  const filtered = gheRepos.filter((r) => !watchedSet.has(r.full_name));

  return {
    repos: filtered.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      owner: r.owner.login,
      private: r.private,
      description: r.description,
      updatedAt: r.updated_at,
    })),
    page,
    hasMore,
  };
}

/**
 * Bulk-create WatchedRepo records for a connection.
 * Skips duplicates (same connectionId + fullName).
 */
export async function watchRepos(
  prisma: PrismaClient,
  input: WatchReposInput
): Promise<{ count: number }> {
  const result = await prisma.watchedRepo.createMany({
    data: input.repos.map((r) => ({
      connectionId: input.connectionId,
      owner: r.owner,
      name: r.name,
      fullName: r.fullName,
    })),
    skipDuplicates: true,
  });
  return { count: result.count };
}

/**
 * Delete a watched repo and cascade-delete its pull requests.
 */
export async function unwatchRepo(
  prisma: PrismaClient,
  id: string
): Promise<void> {
  await prisma.watchedRepo.delete({ where: { id } });
}

/**
 * List all watched repos with their open PR count.
 */
export async function listWatchedRepos(
  prisma: PrismaClient
): Promise<Array<WatchedRepoDto & { openPrCount: number }>> {
  const rows = await prisma.watchedRepo.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { pullRequests: { where: { state: "OPEN" } } },
      },
    },
  });

  return rows.map((row) => ({
    ...toDto(row),
    openPrCount: row._count.pullRequests,
  }));
}

/**
 * Update polling interval and/or active state for a watched repo.
 */
export async function updateRepoConfig(
  prisma: PrismaClient,
  id: string,
  config: UpdateRepoInput
): Promise<WatchedRepoDto> {
  const updated = await prisma.watchedRepo.update({
    where: { id },
    data: {
      ...(config.pollingInterval !== undefined && {
        pollingInterval: config.pollingInterval,
      }),
      ...(config.isActive !== undefined && { isActive: config.isActive }),
      ...(config.promptTemplate !== undefined && {
        promptTemplate: config.promptTemplate,
      }),
      ...(config.systemPromptTemplate !== undefined && {
        systemPromptTemplate: config.systemPromptTemplate,
      }),
    },
  });
  return toDto(updated);
}
