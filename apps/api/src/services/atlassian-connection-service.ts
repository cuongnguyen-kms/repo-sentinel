/**
 * Business logic for the singleton Atlassian connection.
 * Handles get/replace/delete/test operations.
 * API tokens are NEVER returned in any output — encrypted at rest.
 *
 * SSRF protection: validateAtlassianHostname() enforces *.atlassian.net + DNS check.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import type { AtlassianConnectionDto, AtlassianConnectionTestResult, CreateAtlassianConnectionInput } from "@repo-sentinel/types";
import { encrypt, decrypt } from "./encryption-service.js";
import { validateAtlassianHostname } from "../utils/hostname-validation.js";
import { fetchCurrentUser } from "./atlassian-api-client-service.js";

function toDto(row: { id: string; hostname: string; email: string; createdAt: Date; updatedAt: Date }): AtlassianConnectionDto {
  return {
    id: row.id,
    hostname: row.hostname,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Fetch the singleton connection (no token), or null if none configured. */
export async function getConnection(prisma: PrismaClient): Promise<AtlassianConnectionDto | null> {
  const row = await prisma.atlassianConnection.findFirst();
  return row ? toDto(row) : null;
}

/**
 * Validate hostname, live-test credentials, encrypt token, then replace the singleton row.
 * Throws if validation or credential check fails.
 */
export async function replaceConnection(
  prisma: PrismaClient,
  input: CreateAtlassianConnectionInput
): Promise<AtlassianConnectionDto> {
  await validateAtlassianHostname(input.hostname);

  const user = await fetchCurrentUser(input.hostname, input.email, input.apiToken);
  if (!user.accountId) {
    throw new Error("Atlassian credentials are invalid — could not retrieve account info");
  }

  const encryptedToken = encrypt(input.apiToken);
  const existing = await prisma.atlassianConnection.findFirst();
  const row = existing
    ? await prisma.atlassianConnection.update({
        where: { id: existing.id },
        data: { hostname: input.hostname, email: input.email, apiToken: encryptedToken },
      })
    : await prisma.atlassianConnection.create({
        data: { hostname: input.hostname, email: input.email, apiToken: encryptedToken },
      });
  return toDto(row);
}

/** Delete the singleton connection, if one exists. */
export async function deleteConnection(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.atlassianConnection.findFirst();
  if (existing) await prisma.atlassianConnection.delete({ where: { id: existing.id } });
}

/**
 * Fetch the stored connection, decrypt the token, and perform a live API test.
 * Returns a result object — does NOT throw on Atlassian failure.
 */
export async function testConnection(prisma: PrismaClient): Promise<AtlassianConnectionTestResult> {
  const row = await prisma.atlassianConnection.findFirst();
  if (!row) {
    return { success: false, message: "No Atlassian connection configured" };
  }

  try {
    await validateAtlassianHostname(row.hostname);
    const apiToken = decrypt(row.apiToken);
    const user = await fetchCurrentUser(row.hostname, row.email, apiToken);
    return { success: true, message: "Connection is valid", displayName: user.displayName };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message };
  }
}

/** Internal only — decrypted token, used by jira-ticket-service / jira-checklist-service / run-ai-review-job. */
export async function getDecryptedConnection(
  prisma: PrismaClient
): Promise<{ id: string; hostname: string; email: string; apiToken: string } | null> {
  const row = await prisma.atlassianConnection.findFirst();
  if (!row) return null;

  return {
    id: row.id,
    hostname: row.hostname,
    email: row.email,
    apiToken: decrypt(row.apiToken),
  };
}
