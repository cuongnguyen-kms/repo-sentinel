/**
 * Reads AI-updated open-comments.json after review completes, validates entries,
 * and applies resolution updates to PostedFindingComment records in the DB.
 */

import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@repo-sentinel/db";
import type { CodeReviewFinding, OpenCommentEntry } from "@repo-sentinel/types";
import { OPEN_COMMENTS_FILENAME } from "./open-comments-writer-service.js";
import { hashFingerprint } from "./finding-fingerprint-service.js";

const VALID_RESOLUTIONS = new Set(["RESOLVED", "STILL_OPEN"]);
const VALID_REASONS = new Set(["CODE_FIX", "LINE_NOT_IN_DIFF", "NO_LONGER_FLAGGED"]);

/** Metadata for a STILL_OPEN entry — used to inject into the latest review's findings. */
export interface StillOpenFindingEntry {
  findingId: string;
  title: string;
  file: string;
  line: number;
  severity: string;
  comment: string;
  updatedLine?: number | null;
}

export interface ResolutionResult {
  resolved: number;
  stillOpen: number;
  skipped: number; // null resolution — AI didn't process the entry
  invalid: number; // malformed/unrecognized values
  carriedOver: number; // STILL_OPEN comments moved to the latest review
  /** STILL_OPEN entries with full metadata — for injecting into the latest review's findings */
  stillOpenEntries: StillOpenFindingEntry[];
}

interface ParsedEntry extends Omit<OpenCommentEntry, "resolution" | "resolutionReason"> {
  resolution: "RESOLVED" | "STILL_OPEN" | null;
  resolutionReason: string | null;
  updatedLine?: number | null;
}

/** Validate a single entry from the AI-updated open-comments.json. */
function isValidEntry(entry: unknown): entry is ParsedEntry {
  if (typeof entry !== "object" || entry === null) return false;
  const obj = entry as Record<string, unknown>;
  if (typeof obj["commentId"] !== "string") return false;
  // resolution can be null (AI didn't process it) — caller will skip those
  if (obj["resolution"] === null || obj["resolution"] === undefined) return true;
  if (!VALID_RESOLUTIONS.has(obj["resolution"] as string)) return false;
  if (obj["resolution"] === "RESOLVED" && obj["resolutionReason"] !== null) {
    if (!VALID_REASONS.has(obj["resolutionReason"] as string)) return false;
  }
  // STILL_OPEN must not carry a resolutionReason; optional numeric updatedLine allowed
  if (obj["resolution"] === "STILL_OPEN" && obj["resolutionReason"] != null) return false;
  if (obj["resolution"] === "STILL_OPEN" && obj["updatedLine"] !== undefined && obj["updatedLine"] !== null) {
    if (typeof obj["updatedLine"] !== "number") return false;
  }
  return true;
}

/**
 * Upsert PostedFindingComment records for the current review's findings that
 * match resolved old findings by fingerprint. Runs after the main resolution
 * loop so the frontend can show resolved status for the current run immediately.
 */
async function propagateToCurrentRun(
  prisma: PrismaClient,
  currentReview: { reviewId: string; findings: CodeReviewFinding[] },
  resolvedEntries: Array<{ file: string; severity: string; title: string; reason: string }>,
  commitSha: string,
  log?: { info: (obj: Record<string, unknown>, msg: string) => void }
): Promise<void> {
  const currentByFingerprint = new Map<string, string>();
  for (const f of currentReview.findings) {
    const key = f.fingerprint ?? hashFingerprint(f.file, f.severity, f.title);
    currentByFingerprint.set(key, f.id);
  }

  let propagated = 0;
  for (const { file, severity, title, reason } of resolvedEntries) {
    const fingerprint = hashFingerprint(file, severity, title);
    const currentFindingId = currentByFingerprint.get(fingerprint);
    if (!currentFindingId) continue;

    await prisma.postedFindingComment.upsert({
      where: { reviewId_findingId: { reviewId: currentReview.reviewId, findingId: currentFindingId } },
      create: {
        reviewId: currentReview.reviewId,
        findingId: currentFindingId,
        githubCommentId: null,
        githubHtmlUrl: "", // sentinel: resolved locally, never posted to GitHub
        resolutionStatus: "RESOLVED",
        resolutionReason: reason,
        resolvedAt: new Date(),
        resolvedByCommitSha: commitSha,
      },
      update: {
        resolutionStatus: "RESOLVED",
        resolutionReason: reason,
        resolvedAt: new Date(),
        resolvedByCommitSha: commitSha,
      },
    });
    propagated++;
  }

  if (propagated > 0) {
    log?.info({ propagated }, "[open-comments-resolution] propagated resolutions to current run's findings");
  }
}

/** Data needed to carry a STILL_OPEN comment to the latest review. */
interface CarryOverEntry {
  /** PostedFindingComment.id (CUID) — set when comment was posted to GitHub */
  commentId: string;
  /** Original finding ID from the review (F1, F2, etc.) */
  findingId: string;
  /** Fingerprint hash (file+severity+title) — used to generate a unique, stable finding ID */
  fp: string;
}

/** Data needed to carry a local-only STILL_OPEN finding to the latest review. */
interface LocalCarryOverEntry {
  sourceReviewId: string;
  findingId: string;
  githubHtmlUrl: string;
  /** Fingerprint hash (file+severity+title) — used to generate a unique, stable finding ID */
  fp: string;
}

/**
 * Move STILL_OPEN PostedFindingComment records to the latest review.
 * Performs a delete + create per entry (can't update the composite PK reviewId+findingId).
 * Only acts on GitHub-posted entries (CUID commentId with no colon).
 */
async function carryOverStillOpenComments(
  prisma: PrismaClient,
  entries: CarryOverEntry[],
  targetReviewId: string,
  log?: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void }
): Promise<number> {
  let carried = 0;
  for (const entry of entries) {
    try {
      const existing = await prisma.postedFindingComment.findUnique({
        where: { id: entry.commentId },
        select: {
          id: true,
          reviewId: true,
          findingId: true,
          githubCommentId: true,
          githubHtmlUrl: true,
          postedAt: true,
          deletedOnGithub: true,
          resolutionStatus: true,
        },
      });

      if (!existing || existing.resolutionStatus !== "OPEN") continue;
      // Skip if already on the target review (nothing to move)
      if (existing.reviewId === targetReviewId) continue;

      // Use fingerprint-based ID to ensure uniqueness across findings from different reviews
      const newFindingId = `carried-${entry.fp.substring(0, 16)}`;

      await prisma.$transaction([
        prisma.postedFindingComment.delete({ where: { id: existing.id } }),
        prisma.postedFindingComment.upsert({
          where: { reviewId_findingId: { reviewId: targetReviewId, findingId: newFindingId } },
          create: {
            reviewId: targetReviewId,
            findingId: newFindingId,
            githubCommentId: existing.githubCommentId,
            githubHtmlUrl: existing.githubHtmlUrl,
            postedAt: existing.postedAt,
            deletedOnGithub: existing.deletedOnGithub,
            resolutionStatus: "OPEN",
            carriedFromReviewId: existing.reviewId,
          },
          update: {
            githubCommentId: existing.githubCommentId,
            githubHtmlUrl: existing.githubHtmlUrl,
            carriedFromReviewId: existing.reviewId,
          },
        }),
      ]);
      carried++;
    } catch (err) {
      log?.warn(
        { commentId: entry.commentId, error: err instanceof Error ? err.message : String(err) },
        "[open-comments-resolution] carry-over failed for entry"
      );
    }
  }
  return carried;
}

/**
 * Create PostedFindingComment records for local-only STILL_OPEN findings on the latest review.
 * These findings were never posted to GitHub (synthetic commentId with ":") so there's no
 * existing PFC record to move — we create one so the frontend can detect the carry-over.
 */
async function carryOverLocalStillOpenComments(
  prisma: PrismaClient,
  entries: LocalCarryOverEntry[],
  targetReviewId: string,
  log?: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void }
): Promise<number> {
  let carried = 0;
  for (const entry of entries) {
    const newFindingId = `carried-${entry.fp.substring(0, 16)}`;
    try {
      await prisma.postedFindingComment.upsert({
        where: { reviewId_findingId: { reviewId: targetReviewId, findingId: newFindingId } },
        create: {
          reviewId: targetReviewId,
          findingId: newFindingId,
          githubCommentId: null,
          githubHtmlUrl: entry.githubHtmlUrl,
          resolutionStatus: "OPEN",
          carriedFromReviewId: entry.sourceReviewId,
        },
        update: {
          carriedFromReviewId: entry.sourceReviewId,
        },
      });
      carried++;
    } catch (err) {
      log?.warn(
        { findingId: entry.findingId, error: err instanceof Error ? err.message : String(err) },
        "[open-comments-resolution] local carry-over failed for entry"
      );
    }
  }
  return carried;
}

/**
 * Read AI-updated open-comments.json, validate entries, apply resolution
 * updates to PostedFindingComment records in DB.
 *
 * @param currentReview - Optional current review context. When provided,
 *   resolutions are also propagated to matching findings in the current run
 *   (matched by fingerprint) so the UI reflects resolved status immediately.
 * @returns Resolution counts, or null if file missing/unreadable.
 */
export async function applyOpenCommentResolutions(
  prisma: PrismaClient,
  repoPath: string,
  commitSha: string,
  currentReview?: { reviewId: string; findings: CodeReviewFinding[] },
  log?: {
    info: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
  }
): Promise<ResolutionResult | null> {
  const filePath = join(repoPath, OPEN_COMMENTS_FILENAME);

  // 1. Read file
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      log?.info({}, "[open-comments-resolution] open-comments file not found — skipping");
      return null;
    }
    log?.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "[open-comments-resolution] failed to read open-comments.json"
    );
    return null;
  }

  // 2. Parse JSON
  let entries: unknown[];
  try {
    const parsed = JSON.parse(raw.replace(/^﻿/, "").trim());
    if (!Array.isArray(parsed)) {
      log?.warn({}, "[open-comments-resolution] open-comments.json is not an array");
      return null;
    }
    entries = parsed;
  } catch (err) {
    log?.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "[open-comments-resolution] malformed JSON in open-comments.json"
    );
    return null;
  }

  // 3. Validate and categorize
  const result: ResolutionResult = { resolved: 0, stillOpen: 0, skipped: 0, invalid: 0, carriedOver: 0, stillOpenEntries: [] };
  // GitHub-posted: commentId is a real PostedFindingComment.id (CUID, no ":")
  const toResolveGithub: Array<{ commentId: string; reason: string }> = [];
  // Local-only: commentId is "reviewId:findingId" synthetic composite
  const toResolveLocal: Array<{ reviewId: string; findingId: string; reason: string }> = [];
  // Resolved entry data for propagating to current run's matching findings
  const toPropagate: Array<{ file: string; severity: string; title: string; reason: string }> = [];
  // STILL_OPEN GitHub-posted entries to carry over to the latest review
  const toCarryOver: CarryOverEntry[] = [];
  // STILL_OPEN local-only entries to carry over to the latest review
  const toCarryOverLocal: LocalCarryOverEntry[] = [];

  for (const entry of entries) {
    if (!isValidEntry(entry)) {
      result.invalid++;
      continue;
    }
    // WONT_FIX entries are informational only — Claude leaves them untouched, no DB update needed
    if (entry.status === "WONT_FIX") {
      continue;
    }
    if (entry.resolution === "RESOLVED") {
      const reason = entry.resolutionReason ?? "CODE_FIX";
      const colonIdx = entry.commentId.indexOf(":");
      if (colonIdx === -1) {
        // CUID — existing PostedFindingComment.id
        toResolveGithub.push({ commentId: entry.commentId, reason });
      } else {
        // Synthetic "reviewId:findingId" — local-only finding, never posted to GitHub
        toResolveLocal.push({
          reviewId: entry.commentId.slice(0, colonIdx),
          findingId: entry.commentId.slice(colonIdx + 1),
          reason,
        });
      }
      if (currentReview) {
        toPropagate.push({ file: entry.file, severity: entry.severity, title: entry.title, reason });
      }
    } else if (entry.resolution === "STILL_OPEN") {
      result.stillOpen++;
      result.stillOpenEntries.push({
        findingId: entry.findingId,
        title: entry.title,
        file: entry.file,
        line: entry.line,
        severity: entry.severity,
        comment: entry.comment,
        updatedLine: entry.updatedLine,
      });
      if (currentReview) {
        const fp = hashFingerprint(entry.file, entry.severity, entry.title);
        const colonIdx = entry.commentId.indexOf(":");
        if (colonIdx === -1) {
          toCarryOver.push({ commentId: entry.commentId, findingId: entry.findingId, fp });
        } else {
          toCarryOverLocal.push({
            sourceReviewId: entry.commentId.slice(0, colonIdx),
            findingId: entry.findingId,
            githubHtmlUrl: entry.githubHtmlUrl ?? "",
            fp,
          });
        }
      }
    } else {
      // null resolution — AI didn't process this entry
      result.skipped++;
    }
  }

  // 4. Apply DB updates batched by reason
  if (toResolveGithub.length > 0) {
    const byReason = new Map<string, string[]>();
    for (const { commentId, reason } of toResolveGithub) {
      if (!byReason.has(reason)) byReason.set(reason, []);
      byReason.get(reason)!.push(commentId);
    }

    for (const [reason, ids] of byReason) {
      await prisma.postedFindingComment.updateMany({
        where: {
          id: { in: ids },
          resolutionStatus: "OPEN", // safety: only update genuinely open ones
        },
        data: {
          resolutionStatus: "RESOLVED",
          resolutionReason: reason,
          resolvedAt: new Date(),
          resolvedByCommitSha: commitSha,
        },
      });
    }
  }

  // Upsert local-only resolutions (non-GitHub findings)
  for (const { reviewId, findingId, reason } of toResolveLocal) {
    await prisma.postedFindingComment.upsert({
      where: { reviewId_findingId: { reviewId, findingId } },
      create: {
        reviewId,
        findingId,
        githubCommentId: null,
        githubHtmlUrl: "", // sentinel: local-only, no GitHub URL
        resolutionStatus: "RESOLVED",
        resolutionReason: reason,
        resolvedAt: new Date(),
        resolvedByCommitSha: commitSha,
      },
      update: {
        resolutionStatus: "RESOLVED",
        resolutionReason: reason,
        resolvedAt: new Date(),
        resolvedByCommitSha: commitSha,
      },
    });
  }

  result.resolved = toResolveGithub.length + toResolveLocal.length;

  // 5. Carry over STILL_OPEN comments to the latest review
  if (currentReview) {
    let totalCarried = 0;
    if (toCarryOver.length > 0) {
      totalCarried += await carryOverStillOpenComments(prisma, toCarryOver, currentReview.reviewId, log);
    }
    if (toCarryOverLocal.length > 0) {
      totalCarried += await carryOverLocalStillOpenComments(prisma, toCarryOverLocal, currentReview.reviewId, log);
    }
    result.carriedOver = totalCarried;
    if (totalCarried > 0) {
      log?.info({ carriedOver: totalCarried }, "[open-comments-resolution] carried STILL_OPEN comments to latest review");
    }
  }

  // 6. Propagate resolutions to current run's matching findings so the UI reflects
  //    resolved status immediately without waiting for the next review cycle.
  if (currentReview && toPropagate.length > 0) {
    await propagateToCurrentRun(prisma, currentReview, toPropagate, commitSha, log);
  }

  log?.info(
    { resolved: result.resolved, stillOpen: result.stillOpen, skipped: result.skipped, invalid: result.invalid },
    "[open-comments-resolution] processing complete"
  );

  // 7. Clean up file
  try {
    await unlink(filePath);
  } catch {
    // ignore cleanup errors
  }

  return result;
}
