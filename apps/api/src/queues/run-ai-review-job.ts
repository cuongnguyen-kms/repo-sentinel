/**
 * AI review job handler — executed by the BullMQ worker for each "ai-review" job.
 *
 * Flow:
 *   CLONING → clone/fetch repo locally → REVIEWING →
 *   fetch diff → build prompt → stream Claude CLI → COMPLETE | FAILED
 */

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@repo-sentinel/db";
import type { Server as SocketServer } from "socket.io";
import { GheClient } from "@repo-sentinel/ghe-client";
import { decrypt } from "../services/encryption-service.js";
import {
  getCommandTemplate,
  getSettingInt,
  interpolateTemplate,
  buildTemplateVariables,
} from "../services/command-template-service.js";
import {
  executeClaudeCliStreaming,
  clearOutputBuffer,
  getOutputBuffer,
  appendToOutputBuffer,
} from "../services/claude-cli-service.js";
import { ensureRepoReady } from "../services/git-checkout-service.js";
import { parseReviewOutput } from "../services/ai-review-service.js";
import { readCodeReviewJson } from "../services/code-review-json-parser.js";
import { computeFingerprints } from "../services/finding-fingerprint-service.js";
import { writeOpenCommentsJson } from "../services/open-comments-writer-service.js";
import { applyOpenCommentResolutions } from "../services/open-comments-resolution-service.js";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { createNotification, NotificationType } from "../services/notification-persistence-service.js";
import { emitNotificationCreated, emitPrReviewOutdated } from "../services/notification-service.js";

/** Emit phase event to Socket.IO room and persist to DB (fire-and-forget). */
export function emitPhase(
  io: SocketServer,
  prisma: PrismaClient,
  reviewId: string,
  phase: string,
  log?: { warn: (obj: object, msg: string) => void }
): void {
  io.to(`review:${reviewId}`).emit("review:phase", { reviewId, phase });
  prisma.aiReview
    .update({ where: { id: reviewId }, data: { reviewPhase: phase } })
    .catch((err) => log?.warn({ err, reviewId }, "emitPhase DB update failed"));
}

/** Emit a plain-text line to the terminal room and buffer it for replay. */
function emitLog(
  io: SocketServer,
  roomId: string,
  line: string
): void {
  const msg = `${line}\r\n`;
  appendToOutputBuffer(roomId, msg);
  io.to(roomId).emit("review:output", msg);
}

/** Main job body for the ai-review BullMQ worker. */
export async function runAiReviewJob(
  fastify: FastifyInstance,
  reviewId: string,
  prId: string
): Promise<void> {
  const roomId = `review:${reviewId}`;
  const log = fastify.log.child({ reviewId, prId, worker: "ai-review" });

  log.info("job started");

  // 1. Mark RUNNING + CLONING phase
  await fastify.prisma.aiReview.update({
    where: { id: reviewId },
    data: { status: "RUNNING", startedAt: new Date(), reviewPhase: "CLONING" },
  });
  await fastify.prisma.pullRequest.update({
    where: { id: prId },
    data: { reviewStatus: "IN_PROGRESS" },
  });
  fastify.io.emit("review:started", { prId, reviewId });
  fastify.io.to(roomId).emit("review:phase", { reviewId, phase: "CLONING" });

  // 2. Load PR with repo + connection
  const pr = await fastify.prisma.pullRequest.findUniqueOrThrow({
    where: { id: prId },
    include: { repo: { include: { connection: true } } },
  });
  const token = decrypt(pr.repo.connection.token);
  const repoFullName = `${pr.repo.owner}/${pr.repo.name}`;

  log.info({ repo: repoFullName, branch: pr.headRef }, "cloning/fetching repo");
  emitLog(fastify.io, roomId, `[CLONING] ${repoFullName} @ ${pr.headRef}`);

  // 3. Clone or update repo locally for full codebase context
  const repoPath = await ensureRepoReady(
    pr.repo.connection,
    pr.repo,
    pr.headRef,
    token,
    (line) => {
      log.debug({ gitProgress: line }, "git progress");
      emitLog(fastify.io, roomId, `[CLONING] ${line}`);
    }
  );

  log.info({ repoPath }, "repo ready");
  emitLog(fastify.io, roomId, `[CLONING] Repo ready at ${repoPath}`);

  // 3a. Delete stale files from any previous run so Claude starts fresh
  await unlink(join(repoPath, "code-review-result.json")).catch(() => {});

  // 3b. Write previous open findings for Claude to evaluate during this run
  const { snapshot: openCommentsSnapshot } = await writeOpenCommentsJson(fastify.prisma, prId, repoPath, log);

  // 4. Switch to REVIEWING phase
  emitPhase(fastify.io, fastify.prisma, reviewId, "REVIEWING", log);
  emitLog(fastify.io, roomId, `[REVIEWING] Fetching PR diff…`);

  // 5. Fetch diff for template interpolation ({{diff_content}})
  const gheClient = new GheClient(pr.repo.connection.hostname, token);
  const [maxDiffSize, skipLargeDiff] = await Promise.all([
    getSettingInt("ai.review.maxDiffSize", 500_000),
    getSettingInt("ai.review.skipLargeDiff", 1),
  ]);

  let diff = "";
  let fullDiff = "";
  try {
    const rawDiff = await gheClient.getPullRequestDiff(
      pr.repo.owner,
      pr.repo.name,
      pr.ghePrId
    );
    fullDiff = rawDiff;
    diff =
      rawDiff.length > maxDiffSize
        ? rawDiff.substring(0, maxDiffSize) + "\n\n... [diff truncated]"
        : rawDiff;
    log.info({ diffBytes: diff.length, fullDiffBytes: rawDiff.length, truncated: rawDiff.length > maxDiffSize }, "diff fetched");
    emitLog(fastify.io, roomId, `[REVIEWING] Diff: ${rawDiff.length} bytes${rawDiff.length > maxDiffSize ? ` (truncated to ${maxDiffSize})` : ""}`);
  } catch (err) {
    const isGhTooLarge =
      err instanceof Error &&
      (err.message.includes("too_large") || err.message.includes("diff exceeded the maximum"));
    if (isGhTooLarge) {
      if (skipLargeDiff) {
        log.warn({ prId }, "GitHub diff too large — proceeding without diff (ai.review.skipLargeDiff=1)");
        emitLog(fastify.io, roomId, `[REVIEWING] ⚠ Diff too large for GitHub API — proceeding without diff content`);
        diff = "... [diff unavailable: PR exceeds GitHub's diff size limit]";
      } else {
        throw new Error(
          "PR diff is too large for the GitHub API (exceeds 20 000 lines). " +
          "Enable 'Skip review when diff is too large' in AI Review settings to proceed without diff."
        );
      }
    } else {
      throw err;
    }
  }

  // 6. Build prompt from template (use repo-specific override if set, else global)
  emitLog(fastify.io, roomId, `[REVIEWING] Building prompt from template…`);
  const template = await getCommandTemplate(pr.repo.id);
  const variables = buildTemplateVariables(pr, pr.repo, diff);
  const prompt = interpolateTemplate(template, variables);

  log.info({ promptLength: prompt.length }, "[review] prompt built");
  emitLog(fastify.io, roomId, `[REVIEWING] Prompt: ${prompt.length} chars`);

  // 7. Execute Claude CLI with streaming in the cloned repo directory
  const timeoutMs = (await getSettingInt("ai.review.timeout", 120)) * 1_000;
  log.info({ cwd: repoPath, idleTimeoutMs: timeoutMs }, "spawning Claude CLI");
  emitLog(fastify.io, roomId, `[REVIEWING] Spawning Claude CLI (idle timeout: ${timeoutMs / 1_000}s)…`);
  emitLog(fastify.io, roomId, `─`.repeat(60));

  const result = await executeClaudeCliStreaming({
    prompt,
    cwd: repoPath,
    timeoutMs,
    io: fastify.io,
    roomId,
    reviewId,
    log,
  });

  emitLog(fastify.io, roomId, `─`.repeat(60));

  if (result.timedOut) {
    log.warn({ idleTimeoutMs: timeoutMs }, "review idle timeout — no CLI output for configured duration");
    throw new Error(
      `Review idle timeout: no output from Claude CLI for ${timeoutMs / 1_000}s. ` +
      `The process may be stuck. Adjust "ai.review.timeout" in Settings to change the idle threshold.`
    );
  }
  if (result.exitCode !== 0) {
    log.error({ exitCode: result.exitCode, stderr: result.stderr.substring(0, 200) }, "Claude CLI exited with error");
    throw new Error(
      `Claude CLI exited with code ${result.exitCode}: ${result.stderr.substring(0, 500)}`
    );
  }

  // 8. Parse report + score from both sources
  const reportText = result.resultText || result.stdout;
  const { summary: parsedSummary, score: parsedScore } = parseReviewOutput(reportText);

  // 8a. Read structured code review JSON (best-effort — null if missing/invalid)
  const codeReviewResult = await readCodeReviewJson(repoPath, log);

  // 8b. Compute content-based fingerprints for cross-review matching
  if (codeReviewResult) {
    computeFingerprints(codeReviewResult.findings);
  }

  // Prefer structured JSON data over regex-parsed text
  const summary = codeReviewResult?.summary || parsedSummary;
  const score = codeReviewResult?.score ?? parsedScore;

  log.info(
    { score, summaryLength: summary?.length, costUsd: result.costUsd, durationMs: result.durationMs },
    "review complete — persisting"
  );
  emitLog(fastify.io, roomId, `[COMPLETE] Score: ${score ?? "n/a"} — saving report…`);

  if (codeReviewResult) {
    emitLog(fastify.io, roomId, `[COMPLETE] Found ${codeReviewResult.findings.length} inline findings`);
  }

  const { commitSha } = await fastify.prisma.aiReview.findUniqueOrThrow({
    where: { id: reviewId },
    select: { commitSha: true },
  });

  const codeReviewJson = codeReviewResult ? JSON.stringify(codeReviewResult) : null;

  // 8c. Apply Claude's open-comment resolution results (best-effort — never fails the run)
  const resolutionResult = codeReviewResult
    ? await applyOpenCommentResolutions(
        fastify.prisma,
        repoPath,
        commitSha,
        { reviewId, findings: codeReviewResult.findings },
        log
      )
    : null;
  if (resolutionResult) {
    log.info(
      { resolved: resolutionResult.resolved, stillOpen: resolutionResult.stillOpen, carriedOver: resolutionResult.carriedOver },
      "[open-comments] resolution applied"
    );
  }

  // 9. Persist completed review to DB
  await fastify.prisma.aiReview.update({
    where: { id: reviewId },
    data: {
      status: "COMPLETED",
      command: prompt.substring(0, 50000),
      output: reportText,
      report: reportText,
      summary,
      score,
      codeReviewJson,
      findingsCount: codeReviewResult?.findings.length ?? null,
      diffContent: fullDiff || diff,
      reviewPhase: "COMPLETE",
      completedAt: new Date(),
      openCommentsSnapshot,
    },
  });
  await fastify.prisma.pullRequest.update({
    where: { id: prId },
    data: { reviewStatus: "REVIEWED" },
  });

  // 9a. Check if commits were pushed while the review was running.
  const freshPr = await fastify.prisma.pullRequest.findUniqueOrThrow({
    where: { id: prId },
    select: { headCommitSha: true, title: true },
  });
  if (freshPr.headCommitSha && freshPr.headCommitSha !== commitSha) {
    await fastify.prisma.pullRequest.update({
      where: { id: prId },
      data: { reviewStatus: "UPDATED" },
    });
    emitPrReviewOutdated(
      fastify.io,
      fastify.prisma,
      prId,
      freshPr.title,
      commitSha,
      freshPr.headCommitSha
    );
    log.info(
      { reviewedAt: commitSha, currentHead: freshPr.headCommitSha },
      "review already outdated — new commits arrived during review"
    );
  }

  // 10. Broadcast completion + cleanup buffer
  fastify.io.emit("review:complete", {
    prId,
    reviewId,
    summary,
    score,
    hasFindings: codeReviewResult !== null,
    findingsCount: codeReviewResult?.findings.length ?? 0,
  });
  fastify.io.to(roomId).emit("review:phase", { reviewId, phase: "COMPLETE" });
  createNotification(fastify.prisma, {
    type: NotificationType.REVIEW_COMPLETED,
    title: `Review Complete${score != null ? `: ${score}/10` : ""}`,
    message: summary?.substring(0, 200),
    metadata: { prId, reviewId, score },
  })
    .then(() => emitNotificationCreated(fastify.io))
    .catch(() => {});
  log.info("job completed successfully");

  // Save full terminal log to DB before clearing the in-memory buffer
  try {
    const terminalLog = getOutputBuffer(roomId).join("");
    if (terminalLog.length > 0) {
      await fastify.prisma.aiReview.update({
        where: { id: reviewId },
        data: { terminalLog: terminalLog.substring(0, 500_000) }, // cap at 500KB
      });
    }
  } catch (err) {
    log.warn({ err }, "[terminal-log] failed to save — non-blocking");
  }

  clearOutputBuffer(roomId);
}
