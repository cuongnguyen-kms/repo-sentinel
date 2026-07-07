/**
 * Zod schemas for connection route request validation.
 * Used to parse and validate incoming request bodies and params.
 */

import { z } from "zod";

/**
 * Valid public hostname pattern — requires at least one dot, only alphanumeric and hyphens per label.
 * Blocks bare hostnames (no dot) to prevent localhost/intranet SSRF bypass attempts.
 * Full IP-range SSRF blocking is enforced in connection-service.ts validateHostname().
 */
const HOSTNAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)+$/;

export const createConnectionSchema = z.object({
  hostname: z
    .string()
    .min(1, "Hostname is required")
    .regex(HOSTNAME_REGEX, "Hostname must be a valid domain name (e.g. github.example.com)"),
  username: z.string().min(1, "Username is required"),
  token: z.string().min(1, "Token is required"),
});

export const connectionIdParamSchema = z.object({
  id: z.string().min(1, "Connection ID is required"),
});

export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type ConnectionIdParam = z.infer<typeof connectionIdParamSchema>;
