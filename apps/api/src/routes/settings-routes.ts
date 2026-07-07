/**
 * Settings management routes.
 *
 * GET   /api/settings       — get all settings as key-value object
 * PATCH /api/settings       — bulk update settings { key: value, ... }
 * GET   /api/settings/:key  — get a single setting value
 * PUT   /api/settings/:key  — update a single setting value
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { Resource, Action } from "@repo-sentinel/types";
import { requireAuth } from "../middleware/auth-middleware.js";
import { requirePermission } from "../middleware/permission-middleware.js";
import {
  updateSettingsSchema,
  settingKeyParamSchema,
  updateSingleSettingSchema,
  validateSettingValue,
} from "../schemas/settings-schemas.js";
import {
  getAllSettings,
  updateSettings,
  getSetting,
} from "../services/settings-service.js";

function handleZodError(err: ZodError, reply: FastifyReply): void {
  reply.status(400).send({
    success: false,
    error: "Validation failed",
    details: err.flatten().fieldErrors,
  });
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/settings
  app.get("/api/settings", { preHandler: [requireAuth, requirePermission(Resource.Settings, Action.Read)] }, async (_request, reply: FastifyReply) => {
    try {
      const data = await getAllSettings();
      reply.send({ success: true, data });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch settings";
      reply.status(500).send({ success: false, error: message });
    }
  });

  // PATCH /api/settings — bulk update
  app.patch("/api/settings", { preHandler: [requireAuth, requirePermission(Resource.Settings, Action.Update)] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      handleZodError(parsed.error, reply);
      return;
    }

    // Validate known keys against their constraints
    for (const [key, value] of Object.entries(parsed.data)) {
      const err = validateSettingValue(key, value);
      if (err) {
        reply.status(400).send({ success: false, error: err });
        return;
      }
    }

    try {
      await updateSettings(parsed.data);
      reply.send({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update settings";
      reply.status(500).send({ success: false, error: message });
    }
  });

  // GET /api/settings/:key
  app.get(
    "/api/settings/:key",
    { preHandler: [requireAuth, requirePermission(Resource.Settings, Action.Read)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = settingKeyParamSchema.safeParse(request.params);
      if (!parsed.success) {
        handleZodError(parsed.error, reply);
        return;
      }

      try {
        const value = await getSetting(parsed.data.key, "");
        reply.send({ success: true, data: { key: parsed.data.key, value } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch setting";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // PUT /api/settings/:key
  app.put(
    "/api/settings/:key",
    { preHandler: [requireAuth, requirePermission(Resource.Settings, Action.Update)] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramParsed = settingKeyParamSchema.safeParse(request.params);
      if (!paramParsed.success) {
        handleZodError(paramParsed.error, reply);
        return;
      }

      const bodyParsed = updateSingleSettingSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        handleZodError(bodyParsed.error, reply);
        return;
      }

      const { key } = paramParsed.data;
      const { value } = bodyParsed.data;

      const constraintErr = validateSettingValue(key, value);
      if (constraintErr) {
        reply.status(400).send({ success: false, error: constraintErr });
        return;
      }

      try {
        await updateSettings({ [key]: value });
        reply.send({ success: true, data: { key, value } });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update setting";
        reply.status(500).send({ success: false, error: message });
      }
    }
  );
}
