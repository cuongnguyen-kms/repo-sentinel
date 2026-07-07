/**
 * better-auth server instance.
 * Handles email/password auth, GitHub OAuth, and admin plugin.
 * Uses Prisma adapter for DB and Redis for session storage.
 */
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { prisma } from "@repo-sentinel/db";
import { redis } from "./redis.js";

// Validate required env vars at startup — fail fast rather than silently
const authSecret = process.env["BETTER_AUTH_SECRET"];
if (!authSecret || authSecret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET env var must be set and at least 32 characters");
}

const githubClientId = process.env["GITHUB_CLIENT_ID"];
const githubClientSecret = process.env["GITHUB_CLIENT_SECRET"];

// Fail fast if GitHub OAuth is partially configured — both vars must be set together
if (Boolean(githubClientId) !== Boolean(githubClientSecret)) {
  throw new Error("Both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set together for GitHub OAuth");
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: authSecret,
  baseURL: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3101",
  basePath: "/api/auth",
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
    expiresIn: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  secondaryStorage: {
    get: async (key: string) => await redis.get(key),
    set: async (key: string, value: string, ttl?: number) => {
      if (ttl) {
        await redis.set(key, value, "EX", ttl);
      } else {
        await redis.set(key, value);
      }
    },
    delete: async (key: string) => {
      await redis.del(key);
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  // Only configure GitHub OAuth if both credentials are present
  socialProviders: {
    ...(githubClientId && githubClientSecret
      ? { github: { clientId: githubClientId, clientSecret: githubClientSecret } }
      : {}),
  },
  // Rate limiting: 5 sign-in attempts per 10 seconds to prevent brute-force
  rateLimit: {
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 10, max: 5 },
    },
  },
  plugins: [admin()],
  trustedOrigins: [process.env["WEB_ORIGIN"] ?? "http://localhost:5175"],
});

export type AuthInstance = typeof auth;
