/**
 * requireAuth - Fastify preHandler that validates better-auth session.
 * Attaches request.user and request.sessionData on success.
 * Returns 401 if no valid session, 403 if user is banned.
 */
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";

declare module "fastify" {
  interface FastifyRequest {
    user: { id: string; email: string; name: string; role: string };
    sessionData: { id: string; token: string; expiresAt: Date };
  }
}

export const requireAuth: preHandlerHookHandler = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session?.user || !session?.session) {
      reply.status(401).send({ error: "Unauthorized", code: "AUTH_REQUIRED" });
      return;
    }

    if ((session.user as { banned?: boolean }).banned) {
      reply.status(403).send({ error: "Account suspended", code: "ACCOUNT_BANNED" });
      return;
    }

    request.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: (session.user as { role?: string }).role ?? "user",
    };
    request.sessionData = {
      id: session.session.id,
      token: session.session.token,
      expiresAt: session.session.expiresAt,
    };
  } catch {
    reply.status(401).send({ error: "Unauthorized", code: "AUTH_REQUIRED" });
  }
};
