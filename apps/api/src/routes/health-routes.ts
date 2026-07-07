/**
 * Health check routes.
 * GET /api/health — returns server status and current timestamp.
 */

import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async (_request, _reply) => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });
}
