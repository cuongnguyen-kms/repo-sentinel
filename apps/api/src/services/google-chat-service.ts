/**
 * Google Chat webhook notification service.
 * Sends formatted messages to a Google Chat space after AI review completes,
 * and when a merged PR still has open/unreplied review comments.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import { syncRepliesForPr } from "./github-reply-sync-service.js";
import { syncGithubThreadStatus } from "./github-thread-resolution-service.js";

interface ReviewNotificationData {
  prId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  author: string;
  changedFiles: number;
  score: number | null;
  stats: Record<string, number>;
  totalFindings: number;
  webBaseUrl?: string;
  /** Resolution delta from open comments tracking (review #2+) */
  commentDelta?: {
    resolved: number;
    stillOpen: number;
    newFindings: number;
    carriedOver: number;
  };
}

/** Interpolate {{variables}} in the message template. */
function interpolateMessage(template: string, data: ReviewNotificationData): string {
  const reviewUrl = `${data.webBaseUrl ?? "http://localhost:5175"}/pull-requests/${data.prId}`;

  const vars: Record<string, string> = {
    pr_number: String(data.prNumber),
    pr_title: data.prTitle,
    pr_url: data.prUrl,
    author: data.author,
    changed_files: String(data.changedFiles),
    repowatch_url: reviewUrl,
    score: data.score != null ? String(data.score) : "N/A",
    count_mismatch_requirement: String(data.stats["mismatch_requirement"] ?? 0),
    count_checklist_required: String(data.stats["checklist_required"] ?? 0),
    count_critical: String(data.stats["critical"] ?? 0),
    count_high: String(data.stats["high"] ?? 0),
    count_medium: String(data.stats["medium"] ?? 0),
    count_low: String(data.stats["low"] ?? 0),
    count_info: String(data.stats["info"] ?? 0),
    total_findings: String(data.totalFindings),
    comments_resolved: String(data.commentDelta?.resolved ?? 0),
    comments_still_open: String(data.commentDelta?.stillOpen ?? 0),
    comments_new: String(data.commentDelta?.newFindings ?? 0),
    comments_carried_over: String(data.commentDelta?.carriedOver ?? 0),
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

/**
 * Send a notification to Google Chat webhook after AI review completes.
 * Fire-and-forget — errors are logged but don't break the review pipeline.
 */
export async function sendGoogleChatNotification(
  prisma: PrismaClient,
  data: ReviewNotificationData,
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }
): Promise<void> {
  const [enabledSetting, webhookSetting, templateSetting] = await prisma.$transaction([
    prisma.appSetting.findUnique({ where: { key: "ai.review.googleChatEnabled" } }),
    prisma.appSetting.findUnique({ where: { key: "ai.review.googleChatWebhook" } }),
    prisma.appSetting.findUnique({ where: { key: "ai.review.googleChatTemplate" } }),
  ]);

  if (enabledSetting?.value !== "1") {
    log?.info({}, "[google-chat] disabled — skipping");
    return;
  }

  const webhookUrl = webhookSetting?.value?.trim();
  if (!webhookUrl) {
    log?.info({}, "[google-chat] webhook not configured — skipping");
    return;
  }

  const template = templateSetting?.value;
  if (!template) return;
  const message = interpolateMessage(template, data);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: message }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log?.warn({ status: res.status, body: body.substring(0, 200) }, "[google-chat] webhook request failed");
    } else {
      log?.info({ prId: data.prId }, "[google-chat] notification sent");
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: errMsg }, "[google-chat] webhook request error");
  }
}

// ---------------------------------------------------------------------------
// Merged PR Reminder — sent when a PR is merged with open/unreplied comments
// ---------------------------------------------------------------------------

interface MergedPrReminderData {
  prId: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  author: string;
  openComments: number;
  resolvedNoReply: number;
  replyBreakdown: string;
  webBaseUrl?: string;
}

function interpolateMergedPrMessage(template: string, data: MergedPrReminderData): string {
  const reviewUrl = `${data.webBaseUrl ?? "http://localhost:5175"}/pull-requests/${data.prId}`;
  const vars: Record<string, string> = {
    pr_number: String(data.prNumber),
    pr_title: data.prTitle,
    pr_url: data.prUrl,
    author: data.author,
    repowatch_url: reviewUrl,
    open_comments: String(data.openComments),
    resolved_no_reply: String(data.resolvedNoReply),
    reply_breakdown: data.replyBreakdown,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

/**
 * Send a reminder to Google Chat when a PR is merged but still has open
 * comments or resolved comments with no reply (empty resolution).
 * Fire-and-forget — errors are logged but don't break the polling pipeline.
 */
export async function sendMergedPrReminder(
  prisma: PrismaClient,
  prId: string,
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }
): Promise<void> {
  const [enabledSetting, webhookSetting, templateSetting] = await prisma.$transaction([
    prisma.appSetting.findUnique({ where: { key: "ai.review.googleChatEnabled" } }),
    prisma.appSetting.findUnique({ where: { key: "ai.review.googleChatWebhook" } }),
    prisma.appSetting.findUnique({ where: { key: "ai.review.googleChatMergedPrTemplate" } }),
  ]);

  if (enabledSetting?.value !== "1") return;

  const webhookUrl = webhookSetting?.value?.trim();
  if (!webhookUrl) return;

  const pr = await prisma.pullRequest.findUnique({
    where: { id: prId },
    select: { ghePrId: true, title: true, htmlUrl: true, authorLogin: true },
  });
  if (!pr) return;

  // Sync replies + thread resolution from GitHub before counting.
  // Without this, replyCount stays 0 and all resolved comments appear as "no reply".
  try {
    await syncRepliesForPr(prisma, prId, log);
    await syncGithubThreadStatus(prisma, prId);
  } catch (syncErr) {
    log?.warn({ err: syncErr instanceof Error ? syncErr.message : syncErr, prId }, "[merged-pr-reminder] sync failed — skipping reminder to avoid wrong data");
    return;
  }

  const [openComments, resolvedNoReply] = await prisma.$transaction([
    prisma.postedFindingComment.count({
      where: {
        review: { pullRequestId: prId },
        githubHtmlUrl: { not: "" },
        resolutionStatus: "OPEN",
      },
    }),
    // Only count genuinely unreplied comments — exclude auto-resolved and thread-resolved.
    prisma.postedFindingComment.count({
      where: {
        review: { pullRequestId: prId },
        githubHtmlUrl: { not: "" },
        resolutionStatus: "RESOLVED",
        replyCount: 0,
        githubThreadResolved: false,
        OR: [
          { resolutionReason: null },
          { resolutionReason: { notIn: ["NO_LONGER_FLAGGED", "SUPERSEDED", "LINE_NOT_IN_DIFF", "CODE_FIX", "MANUAL"] } },
        ],
      },
    }),
  ]);

  const allComments = await prisma.postedFindingComment.findMany({
    where: {
      review: { pullRequestId: prId },
      githubHtmlUrl: { not: "" },
    },
    select: { replyCount: true, lastReplyBody: true },
  });
  const replyGroups: Record<string, number> = {};
  let noReplyCount = 0;
  for (const c of allComments) {
    if (c.replyCount === 0 || !c.lastReplyBody) {
      noReplyCount++;
    } else {
      const key = c.lastReplyBody.trim().substring(0, 100);
      replyGroups[key] = (replyGroups[key] || 0) + 1;
    }
  }
  const breakdownLines: string[] = [];
  if (noReplyCount > 0) breakdownLines.push(`  🔸 No Reply (${noReplyCount})`);
  const sortedGroups = Object.entries(replyGroups).sort((a, b) => b[1] - a[1]);
  for (const [value, count] of sortedGroups) {
    breakdownLines.push(`  🔹 ${value} (${count})`);
  }
  const replyBreakdown = breakdownLines.length > 0 ? breakdownLines.join("\n") : "  No comments";

  if (openComments === 0 && resolvedNoReply === 0) {
    log?.info({ prId }, "[google-chat-merged] no open/unreplied comments — skipping reminder");
    return;
  }

  const template = templateSetting?.value;
  if (!template) return;
  const message = interpolateMergedPrMessage(template, {
    prId,
    prNumber: pr.ghePrId,
    prTitle: pr.title,
    prUrl: pr.htmlUrl,
    author: pr.authorLogin,
    openComments,
    resolvedNoReply,
    replyBreakdown,
    webBaseUrl: process.env["WEB_ORIGIN"] ?? "http://localhost:5175",
  });

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log?.warn({ status: res.status, body: body.substring(0, 200) }, "[google-chat-merged] webhook failed");
    } else {
      log?.info({ prId, openComments, resolvedNoReply }, "[google-chat-merged] reminder sent");
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: errMsg }, "[google-chat-merged] webhook error");
  }
}
