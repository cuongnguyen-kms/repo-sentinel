/**
 * DTOs for application settings (key/value store).
 */

export interface AppSettingDto {
  key: string;
  value: string;
  updatedAt: string;
}

export interface UpsertSettingInput {
  key: string;
  value: string;
}

/** Well-known AI review setting keys used by the application (MVP subset). */
export const SETTING_KEYS = {
  AI_REVIEW_TIMEOUT: "ai.review.timeout",
  AI_REVIEW_MAX_FILES: "ai.review.maxFiles",
  AI_REVIEW_MAX_DIFF_SIZE: "ai.review.maxDiffSize",
  AI_REVIEW_SKIP_LARGE_DIFF: "ai.review.skipLargeDiff",
  AI_REVIEW_AUTO_REVIEW: "ai.review.autoReview",
  AI_REVIEW_AUTO_REVIEW_STATUSES: "ai.review.autoReviewStatuses",
  AI_REVIEW_AUTO_REVIEW_AUTHORS: "ai.review.autoReviewAuthors",
  AI_REVIEW_AUTO_RERUN_REVIEW: "ai.review.autoRerunReview",
  AI_REVIEW_AUTO_RERUN_REVIEW_STATUSES: "ai.review.autoRerunReviewStatuses",
  AI_REVIEW_PROMPT_TEMPLATE: "ai.review.promptTemplate",
  AI_REVIEW_SYSTEM_PROMPT_TEMPLATE: "ai.review.systemPromptTemplate",
  AI_REVIEW_CLI_PATH: "ai.review.cliPath",
  DEFAULT_POLLING_INTERVAL: "polling.defaultInterval",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
