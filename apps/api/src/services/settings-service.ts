/**
 * Settings service for AppSetting CRUD operations.
 *
 * Provides getAllSettings, updateSettings (bulk upsert), and getSetting (with fallback).
 * All writes use Prisma transactions to ensure consistency.
 */

import { prisma } from "@repo-sentinel/db";

/**
 * Retrieve all AppSetting records as a plain key-value object.
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  const settings = await prisma.appSetting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

/**
 * Bulk upsert settings. Existing keys are updated; new keys are inserted.
 * Runs all upserts in a single transaction.
 */
export async function updateSettings(updates: Record<string, string>): Promise<void> {
  const ops = Object.entries(updates).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  );
  await prisma.$transaction(ops);
}

/**
 * Retrieve a single setting by key.
 * Returns defaultValue if the key does not exist.
 */
export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const s = await prisma.appSetting.findUnique({ where: { key } });
  return s?.value ?? defaultValue;
}
