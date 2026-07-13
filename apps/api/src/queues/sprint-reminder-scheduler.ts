/**
 * BullMQ repeatable scheduler that checks every 60s whether it's time to fire
 * the daily sprint reminder (configured hour:minute in "ai.review.reminderTime*").
 * Fires at most once per day — if the server starts after the target time, it
 * fires on the next check (catch-up).
 *
 * Queue name : "sprint-reminder"
 * Job name   : "check"
 */

import { Queue, Worker } from "bullmq";
import type { FastifyInstance } from "fastify";
import { checkAndSendSprintReminder } from "../services/sprint-reminder-service.js";
import { makeRedisConnection } from "./redis-connection.js";

const QUEUE_NAME = "sprint-reminder";
const CHECK_INTERVAL_MS = 60_000; // 60 seconds

let lastFiredDate = "";

export async function startSprintReminderScheduler(fastify: FastifyInstance): Promise<Worker> {
  const checkQueue = new Queue(QUEUE_NAME, { connection: makeRedisConnection() });

  await checkQueue.upsertJobScheduler(
    "check-sprint-reminder",
    { every: CHECK_INTERVAL_MS },
    { name: "check", data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } }
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const [hourSetting, minuteSetting] = await Promise.all([
        fastify.prisma.appSetting.findUnique({ where: { key: "ai.review.reminderTimeHour" } }),
        fastify.prisma.appSetting.findUnique({ where: { key: "ai.review.reminderTimeMinute" } }),
      ]);

      const targetHour = Number(hourSetting?.value ?? "13");
      const targetMinute = Number(minuteSetting?.value ?? "30");

      const now = new Date();
      const todayKey = now.toISOString().split("T")[0] as string;
      const targetMinutes = targetHour * 60 + targetMinute;
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      if (currentMinutes >= targetMinutes && lastFiredDate !== todayKey) {
        lastFiredDate = todayKey;
        fastify.log.info({ targetHour, targetMinute }, "[sprint-reminder] firing");
        await checkAndSendSprintReminder(fastify.prisma, fastify.log);
      }
    },
    {
      connection: makeRedisConnection(),
      concurrency: 1,
    }
  );

  worker.on("failed", (job, err) => {
    fastify.log.error({ jobId: job?.id, err: err.message }, "[sprint-reminder] check job failed");
  });

  return worker;
}
