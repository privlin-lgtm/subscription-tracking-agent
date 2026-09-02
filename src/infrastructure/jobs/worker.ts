import cron from "node-cron";
import { GmailAuthError } from "@/domain/errors";
import { createApp } from "@/infrastructure/composition";

async function runJob(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`${name} failed:`, error instanceof Error ? error.message : "unknown");
  }
}

async function run(): Promise<void> {
  const app = createApp();

  cron.schedule("0 8 * * *", () => runJob("renewal reminders", () => app.alertJobs.runRenewalReminders()));

  cron.schedule("0 9 * * 1", () => runJob("inactivity scan", () => app.alertJobs.runInactivityScan()));

  cron.schedule("0 3 * * *", () => runJob("snapshot purge", () => app.alertJobs.purgeExpiredSnapshots()));

  cron.schedule("0 4 * * *", () => runJob("audit log purge", () => app.alertJobs.purgeOldAuditLogs()));

  cron.schedule("*/15 * * * *", async () => {
    const userIds = await app.users.listConnectedUserIds();
    for (const userId of userIds) {
      try {
        await app.locks.withUserLock(userId, () => app.gmailSync.syncUser(userId));
      } catch (error) {
        if (error instanceof GmailAuthError) {
          continue;
        }
        console.error(`Gmail sync failed for user ${userId}:`, error instanceof Error ? error.message : "unknown");
      }
    }
  });

  console.log("Subscription tracker worker started");
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "worker failed");
  process.exit(1);
});
