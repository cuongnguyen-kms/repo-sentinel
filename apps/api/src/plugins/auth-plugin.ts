/**
 * Fastify plugin that integrates better-auth.
 * Registers @fastify/cookie and a catch-all /api/auth/* route that delegates to better-auth handler.
 */
import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth.js";

async function authPlugin(app: FastifyInstance): Promise<void> {
  // Cookie parsing required for session cookies
  await app.register(cookie);

  // Catch-all route: delegate all /api/auth/* requests to better-auth
  app.all("/api/auth/*", async (request, reply) => {
    const url = new URL(request.url, `${request.protocol}://${request.hostname}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }

    const fetchRequest = new Request(url.toString(), {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD"
        ? JSON.stringify(request.body)
        : undefined,
    });

    const response = await auth.handler(fetchRequest);

    reply.status(response.status);
    response.headers.forEach((value, key) => {
      reply.header(key, value);
    });
    const body = await response.text();
    reply.send(body);
  });

  // Decorate app with auth instance for use in middleware
  app.decorate("auth", auth);
}

// Extend Fastify types
declare module "fastify" {
  interface FastifyInstance {
    auth: typeof auth;
  }
}

export const registerAuthPlugin = fp(authPlugin, {
  fastify: "5.x",
  name: "auth-plugin",
});
