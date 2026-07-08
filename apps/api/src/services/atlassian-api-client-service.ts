/**
 * Stateless Atlassian REST API client helpers.
 * All functions are pure: accept credentials, return parsed JSON.
 * Rate-limit handling: 429 with Retry-After, max 3 retries, then throws RateLimitExhaustedError.
 *
 * Trimmed from the RepoWatch reference client: only what this MVP's connection
 * test, ticket fetch, and ticket search need. Board/user-search/worklog/changelog/
 * Confluence helpers are out of scope (deferred with the activity-tracking slice).
 */

const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60_000;

export class RateLimitExhaustedError extends Error {
  constructor(hostname: string) {
    super(`Atlassian API rate limit exhausted for ${hostname} after ${MAX_RETRIES} retries`);
    this.name = "RateLimitExhaustedError";
  }
}

/** Build Basic Auth header value from email + API token. */
export function buildAuthHeader(email: string, apiToken: string): string {
  const encoded = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${encoded}`;
}

/**
 * Shared fetch with auth, logging, and 429 retry logic.
 * PRECONDITION: hostname must be validated by validateAtlassianHostname() before calling.
 */
export async function atlassianFetch(
  hostname: string,
  path: string,
  email: string,
  apiToken: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `https://${hostname}${path}`;
  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(email, apiToken),
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(options.headers as Record<string, string> ?? {}),
  };

  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    const response = await fetch(url, { ...options, headers });

    if (response.status !== 429) {
      return response;
    }

    attempt++;
    if (attempt > MAX_RETRIES) {
      throw new RateLimitExhaustedError(hostname);
    }

    const retryAfterHeader = response.headers.get("Retry-After");
    let delayMs = 1000 * attempt; // exponential fallback
    if (retryAfterHeader) {
      const parsed = Number(retryAfterHeader);
      if (!isNaN(parsed) && parsed > 0) {
        delayMs = parsed * 1000;
      }
    }
    delayMs = Math.min(delayMs, MAX_RETRY_DELAY_MS);

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new RateLimitExhaustedError(hostname);
}

/** GET /rest/api/3/myself — verify credentials and retrieve display name. */
export async function fetchCurrentUser(
  hostname: string,
  email: string,
  apiToken: string
): Promise<{ accountId: string; displayName: string; emailAddress: string }> {
  // Try Cloud API (v3) first, fall back to Server/DC API (v2)
  let response = await atlassianFetch(hostname, "/rest/api/3/myself", email, apiToken);
  if (!response.ok) {
    response = await atlassianFetch(hostname, "/rest/api/2/myself", email, apiToken);
  }
  if (!response.ok) {
    throw new Error(`Atlassian auth check failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json() as Record<string, unknown>;
  return {
    accountId: (data.accountId as string) ?? (data.key as string) ?? (data.name as string) ?? "",
    displayName: (data.displayName as string) ?? "",
    emailAddress: (data.emailAddress as string) ?? "",
  };
}

export interface JiraIssue {
  key: string;
  id: string;
  fields: Record<string, unknown>;
}

/** Search JIRA issues by JQL. Uses the current /search/jql endpoint (the older POST /search was removed). */
export async function searchIssuesByJql(
  hostname: string,
  email: string,
  apiToken: string,
  jql: string,
  fields: string[],
  maxResults = 100
): Promise<{ issues: JiraIssue[]; total: number; startAt: number; maxResults: number }> {
  const body = JSON.stringify({ jql, fields, maxResults });
  const response = await atlassianFetch(hostname, "/rest/api/3/search/jql", email, apiToken, { method: "POST", body });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`JQL search failed: ${response.status} ${response.statusText} — ${errorText}`);
  }
  return response.json() as Promise<{ issues: JiraIssue[]; total: number; startAt: number; maxResults: number }>;
}
