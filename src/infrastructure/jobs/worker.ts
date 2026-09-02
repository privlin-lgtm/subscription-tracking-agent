import cron from "node-cron";
import { GmailAuthError } from "@/domain/errors";
import { createApp } from "@/infrastructure/composition";

async function run(): Promise<void> {
  const app = createApp();

  cron.schedule("0 8 * * *", async () => {
    await app.alertJobs.runRenewalReminders();
  });

  cron.schedule("0 9 * * 1", async () => {
    await app.alertJobs.runInactivityScan();
  });

  cron.schedule("0 3 * * *", async () => {
    await app.alertJobs.purgeExpiredSnapshots();
  });

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
