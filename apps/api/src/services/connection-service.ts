/**
 * Business logic for GHE connection management.
 * Handles create, list, delete, and test operations.
 * Tokens are NEVER returned in any output — encrypted at rest.
 *
 * SSRF protection: validateHostname() is called before any outbound GHE request.
 * It blocks localhost, loopback, link-local, private IP ranges, and cloud metadata endpoints.
 */

import type { PrismaClient } from "@repo-sentinel/db";
import { GheClient } from "@repo-sentinel/ghe-client";
import type { GheConnectionDto, ConnectionTestResult } from "@repo-sentinel/types";
import { encrypt, decrypt } from "./encryption-service.js";
import type { CreateConnectionInput } from "../schemas/connection-schemas.js";
import { validateHostname } from "../utils/hostname-validation.js";

/** Map a DB row to a safe DTO — strips the encrypted token field. */
function toDto(row: {
  id: string;
  hostname: string;
  username: string;
  createdAt: Date;
  updatedAt: Date;
}): GheConnectionDto {
  return {
    id: row.id,
    hostname: row.hostname,
    username: row.username,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Validate the connection against the GHE API, encrypt the token, and persist.
 * Throws if the GHE API rejects the credentials.
 */
export async function createConnection(
  prisma: PrismaClient,
  data: CreateConnectionInput
): Promise<GheConnectionDto> {
  // SSRF guard — reject private/loopback/metadata hostnames before any outbound request
  validateHostname(data.hostname);

  // Validate credentials before storing
  const client = new GheClient(data.hostname, data.token);
  const testResult = await client.testConnection();
  if (!testResult.success) {
    throw new Error(`GitHub connection failed: ${testResult.message}`);
  }

  const encryptedToken = encrypt(data.token);

  const row = await prisma.gheConnection.create({
    data: {
      hostname: data.hostname,
      username: data.username,
      token: encryptedToken,
    },
  });

  return toDto(row);
}

/** List all connections without exposing tokens. */
export async function listConnections(
  prisma: PrismaClient
): Promise<GheConnectionDto[]> {
  const rows = await prisma.gheConnection.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      hostname: true,
      username: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return rows.map(toDto);
}

/** Delete a connection and cascade to all watched repos / pull requests. */
export async function deleteConnection(
  prisma: PrismaClient,
  id: string
): Promise<void> {
  await prisma.gheConnection.delete({ where: { id } });
}

/**
 * Fetch the stored connection, decrypt the token, and perform a live API test.
 * Returns a result object — does NOT throw on GHE failure (caller decides).
 */
export async function testConnection(
  prisma: PrismaClient,
  id: string
): Promise<ConnectionTestResult> {
  const row = await prisma.gheConnection.findUnique({ where: { id } });
  if (!row) {
    return { success: false, message: "Connection not found" };
  }

  try {
    // SSRF guard — also validate on test in case hostname was stored before this check existed
    validateHostname(row.hostname);
    const token = decrypt(row.token);
    const client = new GheClient(row.hostname, token);
    return await client.testConnection();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message };
  }
}
