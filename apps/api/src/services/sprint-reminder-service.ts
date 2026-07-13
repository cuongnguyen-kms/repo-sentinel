/**
 * Sprint reminder service.
 * During the last N days of the active JIRA sprint, sends a Google Chat message
 * listing tickets missing the "ai_assisted" label prefix (i.e. no AI review yet).
 */

import type { PrismaClient } from "@repo-sentinel/db";
import { getDecryptedConnection } from "./atlassian-connection-service.js";

interface SprintInfo {
  id: number;
  name: string;
  endDate: string;
  daysRemaining: number;
}

/**
 * Check if we're in the reminder window of the active sprint and send a
 * reminder if any tickets are missing AI review. Called by the scheduler on a timer.
 */
export async function checkAndSendSprintReminder(
  prisma: PrismaClient,
  log?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }
): Promise<void> {
  const settings = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "ai.review.jiraEnabled",
          "ai.review.googleChatEnabled",
          "ai.review.googleChatWebhook",
          "ai.review.googleChatReminderTemplate",
          "ai.review.reminderDaysRemaining",
          "ai.review.sprintReminderEnabled",
        ],
      },
    },
  });
  const map = new Map(settings.map((s) => [s.key, s.value]));

  if (map.get("ai.review.googleChatEnabled") !== "1") {
    log?.info({}, "[sprint-reminder] Google Chat disabled — skipping");
    return;
  }

  if (map.get("ai.review.sprintReminderEnabled") !== "1") {
    log?.info({}, "[sprint-reminder] sprint reminder disabled — skipping");
    return;
  }

  const webhookUrl = map.get("ai.review.googleChatWebhook")?.trim();
  if (!webhookUrl) {
    log?.info({}, "[sprint-reminder] no webhook configured — skipping");
    return;
  }

  if (map.get("ai.review.jiraEnabled") !== "1") {
    log?.info({}, "[sprint-reminder] JIRA not enabled — skipping");
    return;
  }

  const conn = await getDecryptedConnection(prisma);
  if (!conn || !conn.boardId) {
    log?.warn({}, "[sprint-reminder] no Atlassian connection or board ID configured — skipping");
    return;
  }

  const auth = Buffer.from(`${conn.email}:${conn.apiToken}`).toString("base64");
  const hostname = conn.hostname;

  const sprintRes = await fetch(
    `https://${hostname}/rest/agile/1.0/board/${conn.boardId}/sprint?state=active&maxResults=10`,
    { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } }
  );
  if (!sprintRes.ok) {
    log?.warn({ status: sprintRes.status }, "[sprint-reminder] failed to fetch sprints");
    return;
  }

  const sprintData = (await sprintRes.json()) as { values?: Array<Record<string, unknown>> };
  const activeSprint = (sprintData.values ?? [])[0];

  if (!activeSprint || !activeSprint["endDate"]) {
    log?.info({}, "[sprint-reminder] no active sprint found on board");
    return;
  }

  const endDate = new Date(activeSprint["endDate"] as string);
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / msPerDay);

  const reminderDays = Number(map.get("ai.review.reminderDaysRemaining") ?? "3");
  if (daysRemaining > reminderDays || daysRemaining < 0) {
    log?.info({ daysRemaining, reminderDays, sprint: activeSprint["name"] }, "[sprint-reminder] not in reminder window — skipping");
    return;
  }

  const sprintInfo: SprintInfo = {
    id: activeSprint["id"] as number,
    name: activeSprint["name"] as string,
    endDate: endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    daysRemaining,
  };

  log?.info({ sprint: sprintInfo.name, daysRemaining }, "[sprint-reminder] in reminder window — checking tickets");

  const jql = `sprint = ${sprintInfo.id} ORDER BY priority ASC, key ASC`;
  const ticketRes = await fetch(`https://${hostname}/rest/api/3/search/jql`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jql, fields: ["summary", "status", "assignee", "labels"], maxResults: 200 }),
  });
  if (!ticketRes.ok) {
    log?.warn({ status: ticketRes.status }, "[sprint-reminder] failed to fetch tickets");
    return;
  }

  const ticketData = (await ticketRes.json()) as { issues?: Array<Record<string, unknown>> };
  const issues = ticketData.issues ?? [];

  const missingAiLabel = issues.filter((issue) => {
    const fields = (issue["fields"] as Record<string, unknown>) ?? {};
    const labels = (fields["labels"] as string[]) ?? [];
    return !labels.some((l) => l.startsWith("ai_assisted"));
  });

  if (missingAiLabel.length === 0) {
    log?.info({}, "[sprint-reminder] all tickets have ai_assisted label — no reminder needed");
    return;
  }

  const ticketList = missingAiLabel.map((issue) => {
    const fields = (issue["fields"] as Record<string, unknown>) ?? {};
    const status = ((fields["status"] as Record<string, unknown>)?.["name"] as string) ?? "";
    const assignee = ((fields["assignee"] as Record<string, unknown>)?.["displayName"] as string) ?? "Unassigned";
    return `• ${issue["key"]}: ${fields["summary"] ?? ""} [${status}] — ${assignee}`;
  }).join("\n");

  const template = map.get("ai.review.googleChatReminderTemplate");
  if (!template) return;
  const boardUrl = `https://${hostname}/secure/RapidBoard.jspa?rapidView=${conn.boardId}`;

  const message = template
    .replace(/\{\{sprint_name\}\}/g, sprintInfo.name)
    .replace(/\{\{sprint_end\}\}/g, sprintInfo.endDate)
    .replace(/\{\{days_remaining\}\}/g, String(sprintInfo.daysRemaining))
    .replace(/\{\{ticket_list\}\}/g, ticketList)
    .replace(/\{\{ticket_count\}\}/g, String(missingAiLabel.length))
    .replace(/\{\{board_url\}\}/g, boardUrl);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: message }),
    });
    if (res.ok) {
      log?.info({ ticketCount: missingAiLabel.length }, "[sprint-reminder] sent to Google Chat");
    } else {
      const body = await res.text().catch(() => "");
      log?.warn({ status: res.status, body: body.substring(0, 200) }, "[sprint-reminder] webhook failed");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.warn({ err: msg }, "[sprint-reminder] webhook error");
  }
}
