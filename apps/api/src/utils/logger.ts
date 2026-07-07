/**
 * Logger configuration for the API server.
 * Fastify uses pino by default — this exports logger options for consistent formatting.
 */

import type { FastifyServerOptions } from "fastify";

export const loggerOptions: FastifyServerOptions["logger"] =
  process.env["NODE_ENV"] === "production"
    ? true
    : {
        level: "info",
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname",
          },
        },
      };
