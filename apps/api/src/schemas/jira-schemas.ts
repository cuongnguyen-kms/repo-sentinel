/**
 * Zod schemas for JIRA ticket/checklist route request validation.
 */

import { z } from "zod";

export const searchTicketsQuerySchema = z.object({
  jql: z.string().min(1).optional(),
  projectKey: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
});
export type SearchTicketsQuery = z.infer<typeof searchTicketsQuerySchema>;

export const ticketKeyParamSchema = z.object({
  key: z.string().min(1).max(64),
});
export type TicketKeyParam = z.infer<typeof ticketKeyParamSchema>;

export const ticketKeyChecklistParamSchema = z.object({
  ticketKey: z.string().min(1).max(64),
});
export type TicketKeyChecklistParam = z.infer<typeof ticketKeyChecklistParamSchema>;

export const updateChecklistBodySchema = z.object({
  content: z.string().min(1, "Content is required"),
});
export type UpdateChecklistBody = z.infer<typeof updateChecklistBodySchema>;

/** Loosely matches PROJECT-123; null clears the override. */
export const setJiraTicketBodySchema = z.object({
  ticketKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/i).nullable(),
});
export type SetJiraTicketBody = z.infer<typeof setJiraTicketBodySchema>;
