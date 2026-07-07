/**
 * Core polling logic for a single watched repository.
 * Handles ETag conditional requests and PR sync.
 * Tokens are decrypted per-request and never logged or cached long-term.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import { GheClient } from "@repo-sentinel/ghe-client";
import type { Server as SocketServer } from "socket.io";
import { decrypt } from "./encryption-service.js";
import { syncPullRequests, reconcileStalePullRequests } from "./pull-request-service.js";
import { emitPollStatus } from "./notification-service.js";

/**
 * Poll a single watched repository for PR changes.
 *
 * Flow:
 *  1. Load repo + connection from DB
 *  2. Decrypt token, create GheClient
 *  3. Call listPullRequests with stored ETag
 *  4. 304 → update lastPolledAt only (no API quota used)
 *  5. 200 → sync PRs, update ETag + lastPolledAt
 */
export async function pollRepo(
  prisma: PrismaClient,
  repoId: string,
  io: SocketServer
): Promise<void> {
  const repo = await prisma.watchedRepo.findUnique({
    where: { id: repoId },
    include: { connection: true },
  });

  if (!repo || !repo.isActive) return;

  emitPollStatus(io, repoId, "started");

  let token: string;
  try {
    token = decrypt(repo.connection.token);
  } catch {
    emitPollStatus(io, repoId, "error");
    return;
  }

  const client = new GheClient(repo.connection.hostname, token);

  try {
    const result = await client.listPullRequests(repo.owner, repo.name, {
      etag: repo.etag ?? undefined,
    });

    // 304 Not Modified — no quota consumed, just refresh timestamp.
    // Still reconcile stale OPEN PRs: the ETag may have been stored after a merge/close
    // event, meaning those PRs were never reconciled by the old code path.
    if (result.notModified) {
      await reconcileStalePullRequests(prisma, repoId, [], client, repo.owner, repo.name, io);
      await prisma.watchedRepo.update({
        where: { id: repoId },
        data: { lastPolledAt: new Date(), lastPollStatus: "skipped" },
      });
      emitPollStatus(io, repoId, "skipped");
      return;
    }

    // Enrich PRs with diff stats (additions/deletions/changedFiles) since the
    // list endpoint omits them. Only runs when ETag changed.
    const enrichedPulls = await Promise.all(
      result.pullRequests.map(async (pr) => {
        try {
          return await client.getPullRequest(repo.owner, repo.name, pr.number);
        } catch {
          return pr; // fallback to list data if detail fetch fails
        }
      })
    );

    await syncPullRequests(prisma, repoId, enrichedPulls, io);

    // Reconcile PRs that disappeared from the open-PR response (merged/closed on GitHub)
    const fetchedGhePrIds = enrichedPulls.map((pr) => pr.number);
    await reconcileStalePullRequests(prisma, repoId, fetchedGhePrIds, client, repo.owner, repo.name, io);

    await prisma.watchedRepo.update({
      where: { id: repoId },
      data: {
        lastPolledAt: new Date(),
        lastPollStatus: "ok",
        etag: result.etag,
      },
    });

    emitPollStatus(io, repoId, "completed");
  } catch (err: unknown) {
    // Log without exposing the token
    const message = err instanceof Error ? err.message : "Unknown polling error";
    console.error(`[polling] repo=${repoId} error: ${message}`);
    emitPollStatus(io, repoId, "error");

    // Persist error status so the UI can show it on next load
    await prisma.watchedRepo
      .update({ where: { id: repoId }, data: { lastPolledAt: new Date(), lastPollStatus: "error" } })
      .catch(() => undefined);
  }
}

/**
 * Check whether a repo is due for its next polling cycle.
 * Returns true when lastPolledAt is null or the interval has elapsed.
 */
export function isRepoDueForPoll(
  lastPolledAt: Date | null,
  pollingIntervalSeconds: number
): boolean {
  if (!lastPolledAt) return true;
  const elapsed = (Date.now() - lastPolledAt.getTime()) / 1000;
  return elapsed >= pollingIntervalSeconds;
}
