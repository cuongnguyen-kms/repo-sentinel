/**
 * Zod schemas for settings route request validation.
 * Validates known setting keys with appropriate value constraints.
 */

import { z } from "zod";

/** Bulk update body: arbitrary key-value string map */
export const updateSettingsSchema = z.record(z.string(), z.string().min(1));

/** URL param for a single setting key */
export const settingKeyParamSchema = z.object({
  key: z.string().min(1, "Setting key is required"),
});

/** Body for updating a single setting */
export const updateSingleSettingSchema = z.object({
  value: z.string().min(1, "Value is required"),
});

/**
 * Validate a known setting key value against its constraints.
 * Returns an error string if invalid, undefined if valid or unknown key.
 */
export function validateSettingValue(key: string, value: string): string | undefined {
  if (key === "ai.review.timeout") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 60 || n > 600) return "ai.review.timeout must be between 60 and 600";
  }
  if (key === "polling.defaultInterval") {
    const n = parseInt(value, 10);
    if (isNaN(n) || n < 60 || n > 3600) return "polling.defaultInterval must be between 60 and 3600";
  }
  if (key === "ai.review.jiraTicketPattern") {
    try {
      new RegExp(value);
    } catch {
      return "ai.review.jiraTicketPattern must be a valid regular expression";
    }
  }
  return undefined;
}

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type SettingKeyParam = z.infer<typeof settingKeyParamSchema>;
export type UpdateSingleSettingInput = z.infer<typeof updateSingleSettingSchema>;
