/**
 * JIRA ticket extraction, fetch, and search for AI Review and the JIRA browser page.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { JiraTicketDto } from "@repo-sentinel/types";
import { searchIssuesByJql, type JiraIssue } from "./atlassian-api-client-service.js";

const DEFAULT_PATTERN = "[A-Z][A-Z0-9]+-\\d+";

/** Extract unique, uppercased ticket keys from a PR's title, body, and branch name. */
export function extractTicketKeys(title: string, body: string | null, headRef: string, pattern: string): string[] {
  try {
    const regex = new RegExp(pattern, "g");
    const combined = `${title} ${body ?? ""} ${headRef}`;
    const matches = combined.match(regex);
    return matches ? [...new Set(matches.map((m) => m.toUpperCase()))] : [];
  } catch {
    return [];
  }
}

/** Manual override takes precedence; otherwise auto-detect using the settings-configured pattern. */
export async function resolveTicketKeysForPr(
  prisma: PrismaClient,
  pr: { jiraTicketKeyOverride: string | null; title: string; body: string | null; headRef: string }
): Promise<string[]> {
  if (pr.jiraTicketKeyOverride) return [pr.jiraTicketKeyOverride];
  const setting = await prisma.appSetting.findUnique({ where: { key: "ai.review.jiraTicketPattern" } });
  return extractTicketKeys(pr.title, pr.body, pr.headRef, setting?.value ?? DEFAULT_PATTERN);
}

/** Strip HTML tags to plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Convert Atlassian Document Format (ADF) JSON to plain text. */
function adfToPlainText(doc: Record<string, unknown>): string {
  const parts: string[] = [];
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.type === "text" && typeof n.text === "string") {
      parts.push(n.text);
    }
    if (n.type === "hardBreak") parts.push("\n");
    if (n.type === "paragraph") parts.push("\n");
    if (n.type === "listItem") parts.push("\n- ");
    if (n.type === "taskItem") {
      const checked = (n.attrs as Record<string, unknown>)?.state === "DONE";
      parts.push(`\n- [${checked ? "x" : " "}] `);
    }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
    }
  }
  walk(doc);
  return parts.join("").trim();
}

/** Fetch one ticket (Cloud v3, Server v2 fallback), converting ADF/HTML description to plain text. */
export async function fetchJiraTicket(
  hostname: string,
  email: string,
  apiToken: string,
  ticketKey: string
): Promise<JiraTicketDto> {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  const baseUrl = `https://${hostname}`;

  let res = await fetch(`${baseUrl}/rest/api/3/issue/${ticketKey}?expand=renderedFields`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) {
    res = await fetch(`${baseUrl}/rest/api/2/issue/${ticketKey}?expand=renderedFields`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
  }
  if (!res.ok) throw new Error(`JIRA returned ${res.status}: ticket not found or access denied`);

  const issue = (await res.json()) as Record<string, unknown>;
  const fields = (issue.fields as Record<string, unknown>) ?? {};
  const rendered = (issue.renderedFields as Record<string, unknown>) ?? {};

  let description = "";
  if (typeof rendered.description === "string") {
    description = stripHtml(rendered.description);
  } else if (fields.description && typeof fields.description === "object") {
    description = adfToPlainText(fields.description as Record<string, unknown>);
  } else if (typeof fields.description === "string") {
    description = fields.description;
  }

  return {
    key: issue.key as string,
    summary: (fields.summary as string) ?? "",
    description,
    status: ((fields.status as Record<string, unknown>)?.name as string) ?? "",
    url: `${baseUrl}/browse/${issue.key}`,
    updated: (fields.updated as string) ?? new Date().toISOString(),
  };
}

function toTicketDto(hostname: string, issue: JiraIssue): JiraTicketDto {
  const fields = issue.fields;
  const rawDescription = fields.description;
  const description =
    typeof rawDescription === "string"
      ? rawDescription
      : rawDescription && typeof rawDescription === "object"
        ? adfToPlainText(rawDescription as Record<string, unknown>)
        : "";
  return {
    key: issue.key,
    summary: (fields.summary as string) ?? "",
    description,
    status: ((fields.status as Record<string, unknown>)?.name as string) ?? "",
    url: `https://${hostname}/browse/${issue.key}`,
    updated: (fields.updated as string) ?? new Date().toISOString(),
  };
}

/** Thin wrapper over searchIssuesByJql for the JIRA browser page. */
export async function searchTickets(
  hostname: string,
  email: string,
  apiToken: string,
  filter: { jql?: string; projectKey?: string; key?: string }
): Promise<JiraTicketDto[]> {
  const jql =
    filter.jql?.trim() ||
    (filter.key ? `key = ${filter.key.toUpperCase()}` : undefined) ||
    (filter.projectKey ? `project = ${filter.projectKey} ORDER BY updated DESC` : undefined) ||
    "order by updated DESC";
  const fields = ["summary", "status", "description", "updated"];
  const { issues } = await searchIssuesByJql(hostname, email, apiToken, jql, fields, 50);
  return issues.map((issue: JiraIssue) => toTicketDto(hostname, issue));
}
