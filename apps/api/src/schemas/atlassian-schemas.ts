/**
 * Zod schemas for Atlassian connection route request validation.
 */

import { z } from "zod";

const ATLASSIAN_HOSTNAME_REGEX = /^[a-zA-Z0-9-]+\.atlassian\.net$/;

export const replaceAtlassianConnectionSchema = z.object({
  hostname: z.string().min(1).regex(ATLASSIAN_HOSTNAME_REGEX, "Hostname must be a *.atlassian.net domain"),
  email: z.string().email("Must be a valid email address"),
  apiToken: z.string().min(1, "API token is required"),
});
export type ReplaceAtlassianConnectionInput = z.infer<typeof replaceAtlassianConnectionSchema>;

export const testTicketBodySchema = z.object({
  ticketKey: z.string().min(1).max(64).regex(/^[A-Z][A-Z0-9]+-\d+$/i, "Must look like PROJECT-123"),
});
export type TestTicketBody = z.infer<typeof testTicketBodySchema>;
