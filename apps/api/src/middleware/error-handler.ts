/**
 * Global Fastify error handler middleware.
 *
 * Maps known errors to appropriate HTTP status codes.
 * Never exposes internal stack traces or raw error messages for 5xx responses.
 * Returns consistent format: { error: string, code: string, details?: object }
 */

import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

export function globalErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): void {
  const statusCode = error.statusCode ?? 500;

  // Log full error server-side (includes stack trace via Pino)
  request.log.error(
    { err: error, method: request.method, url: request.url },
    "[error-handler] request failed"
  );

  const response: Record<string, unknown> = {
    error: statusCode >= 500 ? "Internal server error" : error.message,
    code: error.code ?? "UNKNOWN",
  };

  // Include validation details only for client errors (4xx)
  if (statusCode < 500 && error.validation) {
    response["details"] = error.validation;
  }

  reply.status(statusCode).send(response);
}
