/**
 * Socket.io plugin — attaches a Socket.io server to the Fastify raw HTTP server.
 * Decorates Fastify instance with `io` for use in route handlers.
 * CORS is configured to match the web app origin.
 */

import fp from "fastify-plugin";
import { Server as SocketIoServer } from "socket.io";
import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyInstance {
    io: SocketIoServer;
  }
}

const ALLOWED_ORIGIN = process.env["WEB_ORIGIN"] ?? "http://localhost:5175";

/** CUID pattern — starts with 'c' followed by at least 24 lowercase alphanumeric chars. */
const CUID_PATTERN = /^c[a-z0-9]{24,}$/;

async function socketIoPlugin(app: FastifyInstance): Promise<void> {
  const io = new SocketIoServer(app.server, {
    cors: {
      origin: ALLOWED_ORIGIN,
      credentials: true,
    },
  });

  app.decorate("io", io);

  // Validate better-auth session before allowing socket connection
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) return next(new Error("Unauthorized"));

      const session = await auth.api.getSession({
        headers: new Headers({ cookie: cookieHeader }),
      });

      if (!session?.user) return next(new Error("Unauthorized"));
      socket.data.user = session.user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  // Room management for review terminal streaming
  io.on("connection", (socket) => {
    socket.on("review:join", (data: unknown) => {
      const reviewId = (data as Record<string, unknown>)?.reviewId;
      // Validate reviewId format before joining to prevent arbitrary room enumeration
      if (typeof reviewId !== "string" || !CUID_PATTERN.test(reviewId)) return;
      socket.join(`review:${reviewId}`);
    });
    socket.on("review:leave", (data: unknown) => {
      const reviewId = (data as Record<string, unknown>)?.reviewId;
      // Validate reviewId format before leaving
      if (typeof reviewId !== "string" || !CUID_PATTERN.test(reviewId)) return;
      socket.leave(`review:${reviewId}`);
    });
  });

  app.addHook("onClose", (_instance, done) => {
    io.close(() => done());
  });
}

export const registerSocketIoPlugin = fp(socketIoPlugin, {
  fastify: "5.x",
  name: "socket-io-plugin",
});
