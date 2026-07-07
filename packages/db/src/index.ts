/**
 * Prisma client singleton for the repo-sentinel database.
 * Re-exports all Prisma-generated types for convenience.
 *
 * Usage: import { prisma } from "@repo-sentinel/db"
 */

import { PrismaClient } from "@prisma/client";

// Prevent multiple instances during hot-reload in development
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

// Re-export all generated types so consumers only need @repo-sentinel/db
export * from "@prisma/client";
