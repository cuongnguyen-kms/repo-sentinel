/**
 * Seeds default AppSettings on API startup.
 *
 * Uses upsert with empty update so existing user-configured values are never
 * overwritten — only missing keys get their defaults inserted.
 */

import { prisma } from "@repo-sentinel/db";

const DEFAULT_GOOGLE_CHAT_TEMPLATE = [
  "Reviewed #{{pr_number}}: {{pr_title}}",
  "Score: {{score}}/10",
  "File Changed: {{changed_files}}",
  "Link: {{repowatch_url}}",
  "----",
  "Mismatch: {{count_mismatch_requirement}} | CheckList: {{count_checklist_required}}",
  "Critical: {{count_critical}}",
  "High: {{count_high}}",
  "Medium: {{count_medium}}",
  "Low: {{count_low}}",
  "Info: {{count_info}}",
  "----",
  "Comments: {{comments_resolved}} resolved, {{comments_still_open}} still open, {{comments_new}} new",
  "----",
  "PR GitHub: {{pr_url}}",
].join("\n");

const DEFAULT_MERGED_PR_TEMPLATE = [
  "⚠️ *Merged PR Reminder*",
  "📋 <{{pr_url}}|PR #{{pr_number}}: {{pr_title}}>",
  "👤 {{author}} | 🔗 <{{repowatch_url}}|AI Review>",
  "🔴 {{open_comments}} Open comments | 🟡 {{resolved_no_reply}} Resolved (no reply)",
  "💬 Reply breakdown:",
  "{{reply_breakdown}}",
  "👆 Please review and address these comments",
].join("\n");

const DEFAULT_SPRINT_REMINDER_TEMPLATE = [
  "⚠️ Sprint Reminder: {{sprint_name}}",
  "{{days_remaining}} day(s) remaining (ends {{sprint_end}})",
  "",
  "The following {{ticket_count}} tickets are missing AI Review (no \"ai_assisted\" label):",
  "{{ticket_list}}",
  "",
  "Board: {{board_url}}",
].join("\n");

const DEFAULT_CHECKLIST_PROMPT_TEMPLATE = [
  "You are a QA analyst. Generate a requirement checklist from this JIRA ticket for code review purposes.",
  "",
  "## JIRA Ticket: {{ticket_key}}",
  "",
  "### Summary",
  "{{ticket_summary}}",
  "",
  "### Description",
  "{{ticket_description}}",
  "",
  "## Instructions",
  "1. Extract ALL acceptance criteria, requirements, and expected behaviors from the ticket",
  "2. Each checklist item should be a specific, verifiable requirement",
  "3. Include field names, status codes, error formats mentioned in the ticket",
  "4. Output ONLY the checklist content (no frontmatter), using markdown checkbox format: - [ ] Requirement description",
  "Focus on requirements that can be verified against code in a PR.",
].join("\n");

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
  { key: "ai.review.dismissKeywords", value: "not fix,not a fix,invalid,wont fix,won't fix,false positive" },
  { key: "ai.review.autoPostToGithub", value: "0" },
  { key: "ai.review.autoPostSeverities", value: "critical,high,medium,low,info" },
  { key: "ai.review.jiraEnabled", value: "0" },
  { key: "ai.review.jiraTicketPattern", value: "[A-Z][A-Z0-9]+-\\d+" },
  { key: "ai.review.checklistPromptTemplate", value: DEFAULT_CHECKLIST_PROMPT_TEMPLATE },
  { key: "ai.review.googleChatEnabled", value: "0" },
  { key: "ai.review.googleChatWebhook", value: "" },
  { key: "ai.review.googleChatTemplate", value: DEFAULT_GOOGLE_CHAT_TEMPLATE },
  { key: "ai.review.googleChatMergedPrTemplate", value: DEFAULT_MERGED_PR_TEMPLATE },
  { key: "ai.review.googleChatReminderTemplate", value: DEFAULT_SPRINT_REMINDER_TEMPLATE },
  { key: "ai.review.sprintReminderEnabled", value: "0" },
  { key: "ai.review.reminderDaysRemaining", value: "3" },
  { key: "ai.review.reminderTimeHour", value: "13" },
  { key: "ai.review.reminderTimeMinute", value: "30" },
  { key: "report.sprintStartDate", value: "2026-01-05" },
  { key: "report.sprintLengthDays", value: "14" },
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
