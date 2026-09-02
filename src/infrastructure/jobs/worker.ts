import * as Sentry from "@sentry/nextjs";

// This worker is a standalone Node process (not served by Next.js), so it never goes
// through instrumentation.ts / sentry.server.config.ts -- it needs its own Sentry.init(),
// called before anything else can throw.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
});

import cron from "node-cron";
import { GmailAuthError } from "@/domain/errors";
import { createApp } from "@/infrastructure/composition";
import { runWithConcurrency } from "@/shared/concurrency";
import { appConfig } from "@/shared/config";

const runningJobs = new Set<string>();

/**
 * node-cron fires on schedule regardless of whether the previous invocation finished — at
 * enough users, a run can outlast its own interval. This guard skips a tick that would
 * otherwise overlap the still-running previous one, rather than letting two invocations of
 * the same job process the same rows concurrently. Single-process only: running more than one
 * worker replica needs the same distributed-lock treatment app.locks already gives per-user
 * Gmail sync — see docs/phase10-scalability-review.md.
 */
async function runJob(name: string, fn: () => Promise<unknown>): Promise<void> {
  if (runningJobs.has(name)) {
    console.error(`${name} skipped: previous run still in progress`);
    return;
  }
  runningJobs.add(name);
  try {
    await fn();
  } catch (error) {
    console.error(`${name} failed:`, error instanceof Error ? error.message : "unknown");
    Sentry.captureException(error, { tags: { job: name } });
  } finally {
    runningJobs.delete(name);
  }
}

async function run(): Promise<void> {
  const app = createApp();

  cron.schedule("0 8 * * *", () => runJob("renewal reminders", () => app.alertJobs.runRenewalReminders()));

  cron.schedule("0 9 * * 1", () => runJob("inactivity scan", () => app.alertJobs.runInactivityScan()));

  cron.schedule("0 3 * * *", () => runJob("snapshot purge", () => app.alertJobs.purgeExpiredSnapshots()));

  cron.schedule("0 4 * * *", () => runJob("audit log purge", () => app.alertJobs.purgeOldAuditLogs()));

  cron.schedule("*/15 * * * *", () =>
    runJob("gmail sync", async () => {
      const userIds = await app.users.listConnectedUserIds();
      // Each user's sync is an independent OAuth-authenticated call sequence against Gmail --
      // there's no way to batch across users the way the DB-backed alert jobs were (see
      // docs/phase6-database-review.md, D3) -- but running them one at a time doesn't scale:
      // at 10,000 users, even 1s/user serially is ~2.8 hours, far longer than the 15-minute
      // interval. Bounded concurrency keeps per-user locking/error-isolation while letting
      // many users' syncs run at once.
      await runWithConcurrency(userIds, appConfig.gmailSyncConcurrency, async (userId) => {
        try {
          await app.locks.withUserLock(userId, () => app.gmailSync.syncUser(userId));
        } catch (error) {
          if (error instanceof GmailAuthError) {
            return;
          }
          console.error(`Gmail sync failed for user ${userId}:`, error instanceof Error ? error.message : "unknown");
          Sentry.captureException(error, { tags: { job: "gmail sync" }, extra: { userId } });
        }
      });
    }),
  );

  console.log("Subscription tracker worker started");
}

run().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : "worker failed");
  Sentry.captureException(error, { tags: { job: "worker startup" } });
  // Sentry reports asynchronously -- without this, process.exit() below can kill the
  // process before the event actually reaches Sentry.
  await Sentry.flush(2000);
  process.exit(1);
});
