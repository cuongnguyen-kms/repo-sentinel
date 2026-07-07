/**
 * GitHub reply sync service.
 * Fetches reply threads from GitHub for posted AI review findings.
 * Detects dismissal keywords in replies and updates PostedFindingComment.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import { decrypt } from "./encryption-service.js";

interface SyncResult {
  synced: number;
  dismissed: number;
  reopened: number;
  errors: number;
}

/**
 * Sync GitHub replies for all posted comments of a review.
 */
export async function syncRepliesForReview(
  prisma: PrismaClient,
  reviewId: string,
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, dismissed: 0, reopened: 0, errors: 0 };

  const review = await prisma.aiReview.findUnique({
    where: { id: reviewId },
    include: {
      pullRequest: {
        include: { repo: { include: { connection: true } } },
      },
    },
  });
  if (!review?.pullRequest?.repo?.connection) {
    log?.warn({ reviewId }, "[reply-sync] review/PR/connection not found");
    return result;
  }

  const pr = review.pullRequest;
  const conn = pr.repo.connection;
  const token = decrypt(conn.token);

  const dismissSetting = await prisma.appSetting.findUnique({
    where: { key: "ai.review.dismissKeywords" },
  });
  const dismissKeywords = (dismissSetting?.value ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  const postedComments = await prisma.postedFindingComment.findMany({
    where: { reviewId, githubHtmlUrl: { not: "" } },
    select: { id: true, githubCommentId: true, githubHtmlUrl: true, replyCount: true },
  });

  if (postedComments.length === 0) {
    log?.info({ reviewId }, "[reply-sync] no posted comments");
    return result;
  }

  try {
    const allComments = await fetchPrReviewComments(conn.hostname, token, pr.repo.owner, pr.repo.name, pr.ghePrId);

    // Build map: commentId -> replies
    const replyMap = new Map<string, Array<{ id: string; htmlUrl: string; author: string; body: string; createdAt: string }>>();
    for (const comment of allComments) {
      const inReplyTo = comment["in_reply_to_id"];
      if (!inReplyTo) continue;
      const key = String(inReplyTo);
      if (!replyMap.has(key)) replyMap.set(key, []);
      const user = comment["user"] as Record<string, unknown> | undefined;
      replyMap.get(key)!.push({
        id: String(comment["id"] ?? ""),
        htmlUrl: String(comment["html_url"] ?? ""),
        author: String(user?.["login"] ?? "unknown"),
        body: String(comment["body"] ?? ""),
        createdAt: String(comment["created_at"] ?? new Date().toISOString()),
      });
    }

    for (const pc of postedComments) {
      if (!pc.githubCommentId) continue;
      const replies = replyMap.get(pc.githubCommentId) ?? [];

      for (const reply of replies) {
        const isDismissal = checkDismissal(reply.body, dismissKeywords);
        try {
          await prisma.findingReply.upsert({
            where: { githubCommentId: reply.id },
            create: {
              postedCommentId: pc.id,
              githubCommentId: reply.id,
              githubHtmlUrl: reply.htmlUrl,
              author: reply.author,
              body: reply.body,
              isDismissal: isDismissal !== null,
              matchedKeyword: isDismissal,
              createdAtGithub: new Date(reply.createdAt),
            },
            update: {
              body: reply.body,
              isDismissal: isDismissal !== null,
              matchedKeyword: isDismissal,
            },
          });
          result.synced++;
        } catch {
          result.errors++;
        }

        if (isDismissal) {
          await prisma.postedFindingComment.update({
            where: { id: pc.id },
            data: {
              dismissedAt: new Date(),
              dismissedBy: reply.author,
              dismissalKeyword: isDismissal,
              resolutionStatus: "WONT_FIX",
              resolutionReason: "MANUAL",
            },
          });
          result.dismissed++;
        }
      }

      const totalReplies = replies.length;
      const lastReply = replies[replies.length - 1];
      await prisma.postedFindingComment.update({
        where: { id: pc.id },
        data: {
          replyCount: totalReplies,
          lastReplyAt: lastReply ? new Date(lastReply.createdAt) : undefined,
          lastReplyAuthor: lastReply?.author ?? null,
          lastReplyBody: lastReply?.body?.substring(0, 500) ?? null,
          repliesSyncedAt: new Date(),
        },
      });
    }

    log?.info({ reviewId, ...result }, "[reply-sync] completed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ reviewId, err: msg }, "[reply-sync] failed to fetch comments");
    result.errors++;
  }

  return result;
}

/**
 * Sync replies for the most recent completed reviews of a PR.
 */
export async function syncRepliesForPr(
  prisma: PrismaClient,
  prId: string,
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }
): Promise<SyncResult> {
  const reviews = await prisma.aiReview.findMany({
    where: { pullRequestId: prId, status: "COMPLETED" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const total: SyncResult = { synced: 0, dismissed: 0, reopened: 0, errors: 0 };
  for (const r of reviews) {
    const result = await syncRepliesForReview(prisma, r.id, log);
    total.synced += result.synced;
    total.dismissed += result.dismissed;
    total.reopened += result.reopened;
    total.errors += result.errors;
  }
  return total;
}

/** Check if a reply body contains a dismissal keyword. Returns the matched keyword or null. */
function checkDismissal(body: string, keywords: string[]): string | null {
  const lower = body.toLowerCase().trim();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

/** Fetch all review comments for a PR (REST API with pagination). */
async function fetchPrReviewComments(
  hostname: string,
  token: string,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Array<Record<string, unknown>>> {
  const allComments: Array<Record<string, unknown>> = [];

  const apiBase = hostname === "github.com" ? "https://api.github.com" : `https://${hostname}/api/v3`;
  let url: string | null = `${apiBase}/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}`, Accept: "application/json" },
    });
    if (!res.ok) break;
    const data = (await res.json()) as Array<Record<string, unknown>>;
    allComments.push(...data);

    const link = res.headers.get("link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch?.[1] ?? null;
  }

  return allComments;
}

/** Dedup data extracted from existing GitHub review comments. */
export interface ExistingPrComments {
  /** "path:line" keys from inline comments */
  pathLines: Set<string>;
  /** Normalized title strings extracted from comment bodies (for title-based dedup) */
  titles: Set<string>;
}

/**
 * Fetch all existing review comments from GitHub for a PR and extract
 * dedup keys. This is the ground-truth dedup source for auto-posting —
 * prevents duplicate comments even when fingerprints or DB records are
 * inconsistent.
 *
 * Handles both inline comments (path:line) and file-level comments
 * (no line on GitHub — extracts line from body `> **Line X**` pattern,
 * and also extracts the finding title for title-based matching).
 */
export async function fetchExistingPrCommentPaths(
  prisma: PrismaClient,
  prId: string,
  log?: { warn: (obj: object, msg: string) => void }
): Promise<ExistingPrComments> {
  const result: ExistingPrComments = { pathLines: new Set(), titles: new Set() };
  try {
    const pr = await prisma.pullRequest.findUnique({
      where: { id: prId },
      include: { repo: { include: { connection: true } } },
    });
    if (!pr?.repo?.connection) return result;

    const token = decrypt(pr.repo.connection.token);
    const comments = await fetchPrReviewComments(pr.repo.connection.hostname, token, pr.repo.owner, pr.repo.name, pr.ghePrId);

    for (const c of comments) {
      // Only top-level comments (not replies)
      if (c["in_reply_to_id"]) continue;
      const path = String(c["path"] ?? "");
      const body = String(c["body"] ?? "");

      // Inline comments: GitHub provides line number
      const line = c["line"] ?? c["original_line"];
      if (path && line) {
        result.pathLines.add(`${path}:${line}`);
      }

      // File-level comments: extract line from body pattern "> **Line X**"
      if (path && !line) {
        const lineMatch = body.match(/>\s*\*\*Line\s+(\d+)\*\*/);
        if (lineMatch?.[1]) {
          result.pathLines.add(`${path}:${lineMatch[1]}`);
        }
      }

      // Extract finding title from body for title-based dedup.
      // Our posted comments have format: "**[SEVERITY]** title"
      const titleMatch = body.match(/###\s*\w+:\s*(.+)/i)
        ?? body.match(/\*\*\[\w+\]\*\*\s*(.+)/i)
        ?? body.match(/^(?:>\s*\*\*Line\s+\d+\*\*\s*\n\n)?(.+)/);
      if (titleMatch?.[1]) {
        result.titles.add(titleMatch[1].trim().toLowerCase().replace(/\s+/g, " "));
      }
    }
  } catch (err) {
    log?.warn({ err, prId }, "[fetch-pr-comments] failed to fetch GitHub comments");
  }
  return result;
}
