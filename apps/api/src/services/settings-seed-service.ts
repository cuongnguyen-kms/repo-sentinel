/**
 * Seeds default AppSettings on API startup.
 *
 * Uses upsert with empty update so existing user-configured values are never
 * overwritten — only missing keys get their defaults inserted.
 */

import { prisma } from "@repo-sentinel/db";

const DEFAULT_SETTINGS = [
  { key: "ai.review.timeout", value: "120" },
  { key: "ai.review.maxFiles", value: "300" },
  { key: "ai.review.maxDiffSize", value: "500000" },
  { key: "ai.review.skipLargeDiff", value: "1" },
  { key: "ai.review.agent", value: "" },
  { key: "ai.review.model", value: "sonnet" },
  { key: "ai.review.autoReview", value: "0" },
  { key: "ai.review.autoReviewAuthors", value: "" },
  { key: "ai.review.autoReviewStatuses", value: "OPEN" },
  { key: "ai.review.autoRerunReview", value: "0" },
  { key: "ai.review.autoRerunReviewStatuses", value: "OPEN" },
  { key: "polling.defaultInterval", value: "300" },
] as const;

/**
 * Upsert all default settings. Runs on startup; skips rows that already exist.
 */
export async function seedDefaultSettings(): Promise<void> {
  for (const setting of DEFAULT_SETTINGS) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: { key: setting.key, value: setting.value },
    });
  }
}
