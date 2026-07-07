/**
 * CORS plugin — allows the Angular web app (localhost:5175) to call the API.
 * credentials: true is required for session cookies to be sent cross-origin.
 */

import fp from "fastify-plugin";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

const ALLOWED_ORIGIN = process.env["WEB_ORIGIN"] ?? "http://localhost:5175";

async function corsPlugin(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === ALLOWED_ORIGIN) return cb(null, true);
      cb(new Error("CORS not allowed"), false);
    },
    credentials: true,
  });
}

export const registerCorsPlugin = fp(corsPlugin, {
  fastify: "5.x",
  name: "cors-plugin",
});
