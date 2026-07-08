/**
 * Fastify API server entry point.
 * Registers all plugins and routes, then starts listening.
 * BullMQ polling worker and scan-repos scheduler are started after listen.
 */

import Fastify from "fastify";
import { loggerOptions } from "./utils/logger.js";
import { registerCorsPlugin } from "./plugins/cors-plugin.js";
import { registerPrismaPlugin } from "./plugins/prisma-plugin.js";
import { registerAuthPlugin } from "./plugins/auth-plugin.js";
import { seedAuthData } from "./lib/auth-seed.js";
import { registerSocketIoPlugin } from "./plugins/socket-io-plugin.js";
import { registerHealthRoutes } from "./routes/health-routes.js";
import { registerAuthPermissionRoutes } from "./routes/auth-permission-routes.js";
import { registerConnectionRoutes } from "./routes/connection-routes.js";
import { registerAtlassianConnectionRoutes } from "./routes/atlassian-connection-routes.js";
import { registerJiraRoutes } from "./routes/jira-routes.js";
import { registerReposRoutes } from "./routes/repos-routes.js";
import { registerPullRequestRoutes } from "./routes/pull-requests-routes.js";
import { registerNotificationRoutes } from "./routes/notification-routes.js";
import { registerReviewRoutes } from "./routes/review-routes.js";
import { registerReviewCommentRoutes } from "./routes/review-comment-routes.js";
import { registerReviewResolutionRoutes } from "./routes/review-resolution-routes.js";
import { registerSettingsRoutes } from "./routes/settings-routes.js";
import { startPollingWorker } from "./queues/repo-polling-queue.js";
import { startScanReposScheduler } from "./queues/scan-repos-scheduler.js";
import { startAiReviewWorker, aiReviewQueue } from "./queues/ai-review-queue.js";
import { seedDefaultSettings } from "./services/settings-seed-service.js";
import { recoverStaleReviews } from "./services/ai-review-service.js";
import { globalErrorHandler } from "./middleware/error-handler.js";

const PORT = Number(process.env["API_PORT"]) || 3101;
const HOST = "0.0.0.0";

async function main(): Promise<void> {
  const app = Fastify({ logger: loggerOptions, trustProxy: true });

  // Plugins (order matters: cors + auth before routes)
  await app.register(registerCorsPlugin);
  await app.register(registerPrismaPlugin);
  await app.register(registerAuthPlugin);
  await app.register(registerSocketIoPlugin);

  app.setErrorHandler(globalErrorHandler);

  // Routes
  await app.register(registerHealthRoutes);
  await app.register(registerAuthPermissionRoutes);
  await app.register(registerConnectionRoutes);
  await app.register(registerAtlassianConnectionRoutes);
  await app.register(registerJiraRoutes);
  await app.register(registerReposRoutes);
  await app.register(registerPullRequestRoutes);
  await app.register(registerNotificationRoutes);
  await app.register(registerReviewRoutes);
  await app.register(registerReviewCommentRoutes);
  await app.register(registerReviewResolutionRoutes);
  await app.register(registerSettingsRoutes);

  // Seed before accepting requests so DB is ready when first request arrives
  await seedDefaultSettings();
  await seedAuthData();

  await app.listen({ port: PORT, host: HOST });

  // Drain waiting/delayed jobs so the worker won't pick up stale jobs from a prior run.
  await aiReviewQueue.drain();

  // Reset any reviews stuck in QUEUED/RUNNING from a prior server run
  await recoverStaleReviews(app.prisma, app.log);

  // Start BullMQ workers after server is ready so prisma + io decorators exist
  startPollingWorker(app);
  startAiReviewWorker(app);
  await startScanReposScheduler(app);

  app.log.info("[queues] polling worker, ai-review worker, and scan-repos scheduler started");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
