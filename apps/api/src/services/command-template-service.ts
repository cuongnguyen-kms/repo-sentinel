/**
 * Command template service for AI review prompts.
 *
 * Templates are stored in AppSetting (key: "ai.review.promptTemplate").
 * Falls back to DEFAULT_TEMPLATE if no DB setting exists.
 * Variable interpolation replaces {{key}} placeholders with actual values.
 */

import { prisma } from "@repo-sentinel/db";
import type { PullRequest, WatchedRepo } from "@repo-sentinel/db";

export const DEFAULT_TEMPLATE = `You are a senior code reviewer. Review this pull request for code quality, bugs, security issues, and best practices.

## PR Context
- **Title**: {{pr_title}} (#{{pr_number}})
- **Branch**: {{head_ref}} -> {{base_ref}}
- **Author**: {{author}}
- **Repository**: {{repo_full_name}}
- **Changed files**: {{changed_files}} (+{{additions}} -{{deletions}})

## Instructions
1. Read the full content of each changed file (not just the diff) to understand surrounding context, imports, and type signatures before forming judgments
2. Write a brief ## Analysis section summarizing what the PR is trying to do and any architectural concerns — this grounds your findings and reduces false positives
3. Provide findings using the severity definitions below
4. End with a quality score (1–10) and summary

## Severity Definitions
- **critical**: data loss, security vulnerability (XSS, SQLi, auth bypass), crash in production
- **high**: incorrect logic, broken feature, significant performance regression, unhandled error path
- **medium**: code smell, unclear logic, missing edge case, poor error message, brittle test
- **low**: naming, style, minor readability, non-idiomatic pattern
- **info**: suggestion, observation, non-blocking note

## Do NOT Flag
- Formatting or whitespace unless it causes bugs
- Missing comments or docs unless required by convention
- Personal style preferences not backed by a team convention
- Issues outside the scope of this PR's changed files
- Test coverage gaps unless clearly needed

## Output Format
Structure your response as a Markdown report with these sections:
- ## Analysis — 1-2 sentences on what the PR does and any structural observations (not scored)
- ## Summary — a substantive 2-4 sentence assessment covering: overall code quality, key risks or issues found, what the PR does well, and your recommendation (approve / request changes / needs discussion). This is the most visible part of the review — do NOT write meta-text about deliverables or files you created.
- ## Findings (with severity badges)
- ## Score: X/10

IMPORTANT: Your markdown report IS the deliverable. Do NOT end with a status message about what files you wrote or what you delivered. End with the Score section.`;

/**
 * Default system prompt template — appended after the user prompt.
 * Contains structured JSON output instructions for inline code review.
 * Stored separately so user prompt changes don't break JSON generation.
 */
export const DEFAULT_SYSTEM_TEMPLATE = `## Structured Review Output (CRITICAL — YOU MUST DO THIS)
After writing your markdown report, use the Write tool to create the file \`./code-review-result.json\` in the current working directory with this exact JSON structure:

\`\`\`json
{
  "score": 7.5,
  "summary": "2-4 sentence assessment: overall quality, key risks, positives, and recommendation",
  "findings": [
    {
      "id": "F1",
      "severity": "high",
      "title": "Short finding title",
      "file": "relative/path/to/file.ts",
      "line": 24,
      "endLine": 28,
      "comment": "Detailed explanation referencing \`specificVariable\` or \`ClassName\`. Use **bold** for emphasis and inline backticks for code identifiers.",
      "suggestion": "\`\`\`ts\nif (condition) {\n  return earlyExit();\n}\n\`\`\`",
      "codeContext": "the actual line(s) of code with the issue"
    }
  ],
  "stats": { "critical": 0, "high": 1, "medium": 2, "low": 1, "info": 0 }
}
\`\`\`

## Scoring Formula
Calculate the score deterministically — do NOT rely on intuition:
1. Start at 10.0
2. Deduct per finding (apply to ALL findings, not just the first):
   - \`critical\`: −2.0 each
   - \`high\`: −1.0 each
   - \`medium\`: −0.5 each
   - \`low\` / \`info\`: no deduction
3. Minimum score: 1.0. Round to 1 decimal place.
4. Write the computed value into the \`score\` field of \`code-review-result.json\` and into the \`## Score: X/10\` section.

## Rules for the JSON file:
- \`id\`: unique within this review (F1, F2, etc.)
- \`severity\`: one of "critical", "high", "medium", "low", "info"
- \`file\`: path relative to repo root (same as shown in the diff)
- \`line\`: line number in the NEW file version — derive from the \`+\` line offset within each \`@@ -old +new @@\` hunk
- \`endLine\`: optional, for multi-line findings
- \`comment\`: use markdown — wrap identifiers/code in backticks (\`variable\`), use **bold** for emphasis; keep to 1-3 sentences
- \`suggestion\`: fenced code block with the correct language tag (e.g. \`\`\`ts\\n...\\n\`\`\`); code only, no prose
- \`codeContext\`: the actual code at the referenced line(s), for display context
- \`stats\`: count of findings per severity level (critical, high, medium, low, info)
- The file MUST be written via the Write tool before you finish — do not just print the JSON as text

## Open Comments Resolution (if applicable)
If a file named \`manager-hub-open-comments.json\` exists in the repo root, it contains previously-posted review findings. You MUST process it:

1. Read \`./manager-hub-open-comments.json\`
2. For each entry:
   - **If \`"status": "WONT_FIX"\`** — this issue has been intentionally dismissed by the user. Do NOT evaluate it, do NOT set any \`resolution\`, and do NOT create a new finding for this issue even if you detect the same problem in the current code. Leave the entry exactly as-is and skip to the next one.
   - **If \`"status": "OPEN"\`** — check the referenced \`file\` and \`line\` against the CURRENT code:
     - If the code issue described in \`comment\` has been fixed → set \`"resolution": "RESOLVED"\` and \`"resolutionReason": "CODE_FIX"\`
     - If the file/line is no longer part of the PR diff (removed or not in changed files) → set \`"resolution": "RESOLVED"\` and \`"resolutionReason": "LINE_NOT_IN_DIFF"\`
     - If the finding is no longer relevant due to code restructuring → set \`"resolution": "RESOLVED"\` and \`"resolutionReason": "NO_LONGER_FLAGGED"\`
     - If the issue still exists in the code → set \`"resolution": "STILL_OPEN"\`, \`"resolutionReason": null\`, and \`"updatedLine": <current line number where the issue now appears>\`. The line number may have shifted due to additions/deletions above it — check the actual current file to find the correct line.
3. Write the updated array back to \`./manager-hub-open-comments.json\` using the Write tool
4. Do NOT create new findings for still-open OPEN issues — they are already tracked. Only include NEW issues in your code-review-result.json findings.

If \`manager-hub-open-comments.json\` does not exist, skip this step entirely.

## How to Get the PR Diff
You are in the cloned repo with the PR branch checked out. Run this command to get the diff:
\`\`\`
git diff origin/{{base_ref}}...HEAD
\`\`\`
Review the diff output along with the surrounding codebase context. Read the full content of changed files as needed for type signatures and surrounding logic.`;

/**
 * Resolve the user prompt from the global fallback chain (no repo context).
 * Fallback: AppSetting "ai.review.promptTemplate" → DEFAULT_TEMPLATE.
 */
async function resolveGlobalUserTemplate(repoOverride: string | null): Promise<string> {
  if (repoOverride) return repoOverride;

  const setting = await prisma.appSetting.findUnique({
    where: { key: "ai.review.promptTemplate" },
  });
  return setting?.value ?? DEFAULT_TEMPLATE;
}

/**
 * Resolve the system prompt from the global fallback chain (no repo context).
 * Fallback: AppSetting "ai.review.systemPromptTemplate" → DEFAULT_SYSTEM_TEMPLATE.
 */
async function resolveGlobalSystemTemplate(repoOverride: string | null): Promise<string> {
  if (repoOverride) return repoOverride;

  const setting = await prisma.appSetting.findUnique({
    where: { key: "ai.review.systemPromptTemplate" },
  });
  return setting?.value ?? DEFAULT_SYSTEM_TEMPLATE;
}

/**
 * Build the full prompt by combining user template + system template.
 * Does a single WatchedRepo query when repoId is provided (both overrides fetched at once),
 * then fans out to global AppSetting lookups concurrently.
 * Pass repoId to use per-repo overrides; omit to use only global templates.
 */
export async function getCommandTemplate(repoId?: string): Promise<string> {
  // Single DB round-trip for both repo-specific override fields
  const repoRow = repoId
    ? await prisma.watchedRepo.findUnique({
        where: { id: repoId },
        select: { promptTemplate: true, systemPromptTemplate: true },
      })
    : null;

  const [userTpl, systemTpl] = await Promise.all([
    resolveGlobalUserTemplate(repoRow?.promptTemplate ?? null),
    resolveGlobalSystemTemplate(repoRow?.systemPromptTemplate ?? null),
  ]);
  // If system template is empty (user cleared it), return user template only
  if (!systemTpl.trim()) return userTpl;
  return `${userTpl}\n\n${systemTpl}`;
}

/**
 * Read an integer AppSetting value with a numeric fallback.
 */
export async function getSettingInt(
  key: string,
  fallback: number
): Promise<number> {
  const setting = await prisma.appSetting.findUnique({ where: { key } });
  if (!setting) return fallback;
  const parsed = parseInt(setting.value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Replace all {{key}} and {key} placeholders in the template string with their values.
 * Double-brace is the canonical format; single-brace supported for backwards compat.
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string | number>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const val = String(value);
    result = result.replaceAll(`{{${key}}}`, val);
    result = result.replaceAll(`{${key}}`, val);
  }
  return result;
}

/**
 * Build the interpolation variable map from PR + repo data and diff content.
 */
export function buildTemplateVariables(
  pr: PullRequest,
  repo: WatchedRepo,
  diffContent: string
): Record<string, string | number> {
  return {
    pr_title: pr.title,
    pr_number: pr.ghePrId,
    head_ref: pr.headRef,
    base_ref: pr.baseRef,
    author: pr.authorLogin,
    repo_full_name: repo.fullName,
    changed_files: pr.changedFiles,
    additions: pr.additions,
    deletions: pr.deletions,
    diff_content: diffContent,
  };
}
