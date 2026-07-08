/**
 * JIRA checklist generation service.
 * Generates requirement checklists from JIRA tickets for AI Review, cached in
 * the `JiraChecklist` DB table (not file-based, so the browser page doesn't
 * depend on any review's on-disk checkout).
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { JiraChecklistDto } from "@repo-sentinel/types";
import { spawn } from "node:child_process";
import { getDecryptedConnection } from "./atlassian-connection-service.js";
import { fetchJiraTicket } from "./jira-ticket-service.js";
import { getSetting } from "./settings-service.js";

function toDto(row: { ticketKey: string; content: string; generatedAt: Date; updatedAt: Date }, stale: boolean): JiraChecklistDto {
  return {
    ticketKey: row.ticketKey,
    content: row.content,
    generatedAt: row.generatedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stale,
  };
}

function buildPrompt(ticket: { key: string; summary: string; description: string }): string {
  return `You are a QA analyst. Generate a requirement checklist from this JIRA ticket for code review purposes.

## JIRA Ticket: ${ticket.key}

### Summary
${ticket.summary}

### Description
${ticket.description}

## Instructions
1. Extract ALL acceptance criteria, requirements, and expected behaviors from the ticket
2. Each checklist item should be a specific, verifiable requirement
3. Include field names, status codes, error formats mentioned in the ticket
4. Output ONLY the checklist content (no frontmatter), using markdown checkbox format: - [ ] Requirement description
Focus on requirements that can be verified against code in a PR.`;
}

/**
 * One-shot, non-streaming Claude CLI invocation — no terminal/room to stream into
 * for this call, unlike the main review job's streaming invocation.
 */
export async function runClaudeCliOnce(cliPath: string, model: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, ["-p", prompt, "--model", model, "--no-session-persistence", "--dangerously-skip-permissions"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDECODE: undefined },
    });
    child.stdin!.end();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Claude CLI timeout (120s)")); }, 120_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Claude CLI failed (code ${code}): ${stderr.substring(0, 200)}`));
    });
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function generateChecklist(
  prisma: PrismaClient,
  ticketKey: string,
  log?: { info: (obj: object, msg: string) => void }
): Promise<JiraChecklistDto> {
  const key = ticketKey.toUpperCase();
  const conn = await getDecryptedConnection(prisma);
  if (!conn) throw new Error("JIRA connection not configured");

  const ticket = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, key);
  const cliPath = (await getSetting("ai.review.agent", "")) || "claude";
  const model = await getSetting("ai.review.model", "sonnet");

  log?.info({ ticketKey: key }, "[jira-checklist] generating");
  const content = await runClaudeCliOnce(cliPath, model, buildPrompt(ticket));

  const row = await prisma.jiraChecklist.upsert({
    where: { ticketKey: key },
    update: { content },
    create: { ticketKey: key, content },
  });
  return toDto(row, false);
}

/** Reads the cached row; staleness is computed by re-fetching the ticket live and comparing timestamps. */
export async function getChecklist(prisma: PrismaClient, ticketKey: string): Promise<JiraChecklistDto | null> {
  const key = ticketKey.toUpperCase();
  const row = await prisma.jiraChecklist.findUnique({ where: { ticketKey: key } });
  if (!row) return null;

  let stale = false;
  try {
    const conn = await getDecryptedConnection(prisma);
    if (conn) {
      const ticket = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, key);
      stale = new Date(ticket.updated).getTime() > row.generatedAt.getTime();
    }
  } catch {
    // Live staleness check is best-effort — fall back to not-stale rather than blocking the read.
  }
  return toDto(row, stale);
}

export async function updateChecklist(prisma: PrismaClient, ticketKey: string, content: string): Promise<JiraChecklistDto> {
  const row = await prisma.jiraChecklist.update({ where: { ticketKey: ticketKey.toUpperCase() }, data: { content } });
  return toDto(row, false);
}

export async function deleteChecklist(prisma: PrismaClient, ticketKey: string): Promise<boolean> {
  try {
    await prisma.jiraChecklist.delete({ where: { ticketKey: ticketKey.toUpperCase() } });
    return true;
  } catch {
    return false;
  }
}

/** Batch read for the review job — only returns rows that already exist, no on-demand generation. */
export async function getCachedChecklistsForKeys(
  prisma: PrismaClient,
  keys: string[]
): Promise<Array<{ ticketKey: string; content: string }>> {
  if (keys.length === 0) return [];
  const rows = await prisma.jiraChecklist.findMany({ where: { ticketKey: { in: keys.map((k) => k.toUpperCase()) } } });
  return rows.map((r) => ({ ticketKey: r.ticketKey, content: r.content }));
}
