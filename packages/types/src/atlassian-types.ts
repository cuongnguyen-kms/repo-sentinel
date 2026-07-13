/**
 * DTOs and input types for the singleton Atlassian connection and JIRA ticket/checklist browsing.
 * NOTE: apiToken is NEVER included in response DTOs — only in create/replace input.
 */

export interface AtlassianConnectionDto {
  id: string;
  hostname: string;
  email: string;
  /** JIRA Agile board ID — optional, only needed for sprint reminders */
  boardId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAtlassianConnectionInput {
  hostname: string;
  email: string;
  /** Raw API token — encrypted before storage, never returned in responses */
  apiToken: string;
  /** JIRA Agile board ID — optional, only needed for sprint reminders */
  boardId?: number | null;
}

export interface AtlassianConnectionTestResult {
  success: boolean;
  message: string;
  displayName?: string;
}

export interface JiraTicketDto {
  key: string;
  summary: string;
  description: string;
  status: string;
  url: string;
  /** ISO timestamp of the ticket's last JIRA-side update — used for checklist staleness comparison */
  updated: string;
}

export interface JiraChecklistDto {
  ticketKey: string;
  content: string;
  generatedAt: string;
  updatedAt: string;
  /** True when the linked ticket's `updated` timestamp is newer than `generatedAt` */
  stale: boolean;
}
