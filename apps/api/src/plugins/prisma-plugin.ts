/**
 * Prisma plugin — decorates the Fastify instance with the PrismaClient singleton.
 * Registers an onClose hook to disconnect on server shutdown.
 *
 * Usage: `request.server.prisma.gheConnection.findMany()`
 */

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { prisma } from "@repo-sentinel/db";
import type { PrismaClient } from "@repo-sentinel/db";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function prismaPlugin(app: FastifyInstance): Promise<void> {
  app.decorate("prisma", prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
}

export const registerPrismaPlugin = fp(prismaPlugin, {
  fastify: "5.x",
  name: "prisma-plugin",
});
