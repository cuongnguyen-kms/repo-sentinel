/**
 * JIRA ticket browsing and checklist routes.
 *
 * GET    /api/jira/tickets                      — search tickets (JQL/project/key)
 * GET    /api/jira/tickets/:key                  — ticket detail
 * GET    /api/jira/checklists/:ticketKey         — checklist content (404 if none)
 * POST   /api/jira/checklists/:ticketKey/generate — synchronous generation
 * PUT    /api/jira/checklists/:ticketKey         — edit content directly
 * DELETE /api/jira/checklists/:ticketKey         — delete cached checklist
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  searchTicketsQuerySchema,
  ticketKeyParamSchema,
  ticketKeyChecklistParamSchema,
  updateChecklistBodySchema,
} from "../schemas/jira-schemas.js";
import { getDecryptedConnection } from "../services/atlassian-connection-service.js";
import { fetchJiraTicket, searchTickets } from "../services/jira-ticket-service.js";
import { getChecklist, generateChecklist, updateChecklist, deleteChecklist } from "../services/jira-checklist-service.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({
    success: false,
    error: "Validation failed",
    details: err.flatten().fieldErrors,
  });
}

export async function registerJiraRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/jira/tickets
  app.get(
    "/api/jira/tickets",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = searchTicketsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      const conn = await getDecryptedConnection(app.prisma);
      if (!conn) {
        reply.status(400).send({ success: false, error: "No Atlassian connection configured" });
        return;
      }
      try {
        const data = await searchTickets(conn.hostname, conn.email, conn.apiToken, parsed.data);
        reply.send({ success: true, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : "JIRA search failed";
        reply.status(502).send({ success: false, error: message });
      }
    }
  );

  // GET /api/jira/tickets/:key
  app.get(
    "/api/jira/tickets/:key",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      const conn = await getDecryptedConnection(app.prisma);
      if (!conn) {
        reply.status(400).send({ success: false, error: "No Atlassian connection configured" });
        return;
      }
      try {
        const data = await fetchJiraTicket(conn.hostname, conn.email, conn.apiToken, parsed.data.key.toUpperCase());
        reply.send({ success: true, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Ticket not found";
        reply.status(404).send({ success: false, error: message });
      }
    }
  );

  // GET /api/jira/checklists/:ticketKey
  app.get(
    "/api/jira/checklists/:ticketKey",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      const data = await getChecklist(app.prisma, parsed.data.ticketKey);
      if (!data) {
        reply.status(404).send({ success: false, error: "Checklist not found" });
        return;
      }
      reply.send({ success: true, data });
    }
  );

  // POST /api/jira/checklists/:ticketKey/generate
  app.post(
    "/api/jira/checklists/:ticketKey/generate",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Create)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      try {
        const data = await generateChecklist(app.prisma, parsed.data.ticketKey, app.log);
        reply.send({ success: true, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Checklist generation failed";
        reply.status(502).send({ success: false, error: message });
      }
    }
  );

  // PUT /api/jira/checklists/:ticketKey
  app.put(
    "/api/jira/checklists/:ticketKey",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      const bodyParsed = updateChecklistBodySchema.safeParse(request.body);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }
      try {
        const data = await updateChecklist(app.prisma, paramParsed.data.ticketKey, bodyParsed.data.content);
        reply.send({ success: true, data });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Checklist not found";
        reply.status(404).send({ success: false, error: message });
      }
    }
  );

  // DELETE /api/jira/checklists/:ticketKey
  app.delete(
    "/api/jira/checklists/:ticketKey",
    { preHandler: [requireAuth, requirePermission(Resource.Atlassian, Action.Delete)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ticketKeyChecklistParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }
      const deleted = await deleteChecklist(app.prisma, parsed.data.ticketKey);
      if (!deleted) {
        reply.status(404).send({ success: false, error: "Checklist not found" });
        return;
      }
      reply.send({ success: true, data: { deleted: true } });
    }
  );
}
