/**
 * WebSocket notification service.
 * Emits Socket.io events to all connected clients for real-time PR updates.
 * Also persists notifications to PostgreSQL (fire-and-forget).
 * Events never include sensitive data (tokens, credentials).
 */

import type { Server as SocketServer } from "socket.io";
import type { PrismaClient } from "@repo-sentinel/db";
import { PrState, NotificationType } from "@repo-sentinel/types";
import { createNotification } from "./notification-persistence-service.js";

/**
 * Emit a lightweight "notification:new" event so the frontend can invalidate
 * the unread count query instantly after a new notification is persisted.
 * Optionally pass a title so the frontend can show a toast for events that
 * don't have a dedicated socket event handler (e.g. review-outdated).
 */
export function emitNotificationCreated(io: SocketServer, title?: string): void {
  io.emit("notification:new", title ? { title } : undefined);
}

/**
 * Emit a "pr:new" event when a previously unseen PR is discovered.
 * Also persists a PR_NEW notification to the database.
 */
export function emitNewPr(
  io: SocketServer,
  prisma: PrismaClient,
  pr: Record<string, unknown>,
  repoId: string,
  repoFullName?: string
): void {
  io.emit("pr:new", { pr, repoId });
  createNotification(prisma, {
    type: NotificationType.PR_NEW,
    title: `New PR: #${pr["ghePrId"] ?? ""} ${pr["title"] ?? ""}`.trim(),
    metadata: { prId: pr["id"], repoId, repoFullName },
  })
    .then(() => emitNotificationCreated(io))
    .catch(() => {});
}

/**
 * Emit a "pr:updated" event when an existing PR's state or metadata changes.
 * Also persists a PR_MERGED or PR_CLOSED notification when the state changes.
 */
export function emitPrUpdated(
  io: SocketServer,
  prisma: PrismaClient,
  pr: Record<string, unknown>,
  changes: { oldState: string; newState: string }
): void {
  io.emit("pr:updated", { pr, changes });

  // Only persist notifications for significant state transitions
  if (changes.newState === PrState.MERGED) {
    createNotification(prisma, {
      type: NotificationType.PR_MERGED,
      title: `PR Merged: #${pr["ghePrId"] ?? ""} ${pr["title"] ?? ""}`.trim(),
      metadata: { prId: pr["id"], repoId: pr["repoId"] },
    })
      .then(() => emitNotificationCreated(io))
      .catch(() => {});
  } else if (changes.newState === PrState.CLOSED) {
    createNotification(prisma, {
      type: NotificationType.PR_CLOSED,
      title: `PR Closed: #${pr["ghePrId"] ?? ""} ${pr["title"] ?? ""}`.trim(),
      metadata: { prId: pr["id"], repoId: pr["repoId"] },
    })
      .then(() => emitNotificationCreated(io))
      .catch(() => {});
  }
}

/**
 * Emit a "poll:status" event to report the outcome of a polling cycle.
 */
export function emitPollStatus(
  io: SocketServer,
  repoId: string,
  status: "started" | "completed" | "skipped" | "error"
): void {
  io.emit("poll:status", { repoId, status });
}

/**
 * Emit a "pr:review-outdated" event when new commits are pushed to an already-reviewed PR.
 * Also persists a REVIEW_OUTDATED notification.
 */
export function emitPrReviewOutdated(
  io: SocketServer,
  prisma: PrismaClient,
  prId: string,
  prTitle: string,
  oldSha: string,
  newSha: string
): void {
  io.emit("pr:review-outdated", { prId, oldSha, newSha });
  createNotification(prisma, {
    type: NotificationType.REVIEW_OUTDATED,
    title: `Review Outdated: ${prTitle}`,
    metadata: { prId, oldSha, newSha },
  })
    .then(() => emitNotificationCreated(io, `Review Outdated: ${prTitle}`))
    .catch(() => {});
}
