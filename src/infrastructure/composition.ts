import { appConfig } from "@/shared/config";
import { AlertJobs } from "@/application/alerts/alert.jobs";
import { RegisterService } from "@/application/auth/register.service";
import { ReviewService, SubscriptionService } from "@/application/subscriptions/subscription.service";
import { SubscriptionPipelineService } from "@/application/subscriptions/subscription-pipeline.service";
import { GmailSyncService } from "@/application/gmail/gmail-sync.service";
import { AesGcmTokenEncryptor } from "@/infrastructure/crypto/token-encryption";
import {
  PrismaAuditRepository,
  PrismaEmailSnapshotRepository,
  PrismaNotificationRepository,
  PrismaProcessedEmailRepository,
  PrismaReviewRepository,
  PrismaSubscriptionRepository,
  PrismaUserRepository,
  PrismaVendorAliasRepository,
} from "@/infrastructure/db/repositories";
import { GoogleGmailClient } from "@/infrastructure/gmail/gmail.client";
import { PostgresAdvisoryLock, systemClock } from "@/infrastructure/jobs/advisory-lock";
import { OpenAiCompatibleExtractor } from "@/infrastructure/llm/openai-compatible.extractor";

export function createApp() {
  const users = new PrismaUserRepository();
  const subscriptions = new PrismaSubscriptionRepository();
  const processedEmails = new PrismaProcessedEmailRepository();
  const audit = new PrismaAuditRepository();
  const notifications = new PrismaNotificationRepository();
  const snapshots = new PrismaEmailSnapshotRepository();
  const vendorAliases = new PrismaVendorAliasRepository();
  const reviews = new PrismaReviewRepository();
  const encryptor = new AesGcmTokenEncryptor(appConfig.tokenEncryptionKey || appConfig.authSecret);
  const gmail = new GoogleGmailClient();
  const extractor = new OpenAiCompatibleExtractor();
  const locks = new PostgresAdvisoryLock();

  const pipeline = new SubscriptionPipelineService({
    users,
    subscriptions,
    processedEmails,
    audit,
    notifications,
    snapshots,
    vendorAliases,
    gmail,
    extractor,
    encryptor,
    clock: systemClock,
    autoApplyThreshold: appConfig.confidenceAutoApplyThreshold,
    fuzzyThreshold: appConfig.vendorFuzzyMatchThreshold,
    snapshotTtlDays: appConfig.emailSnapshotTtlDays,
  });

  return {
    users,
    notifications,
    snapshots,
    encryptor,
    locks,
    registerService: new RegisterService(users),
    subscriptionService: new SubscriptionService(subscriptions, audit),
    reviewService: new ReviewService(subscriptions, reviews, audit),
    gmailSync: new GmailSyncService(
      users,
      processedEmails,
      gmail,
      encryptor,
      pipeline,
      notifications,
      audit,
      systemClock,
      appConfig.gmailLookbackMonths,
      appConfig.gmailMaxLookbackMessages,
    ),
    alertJobs: new AlertJobs(
      users,
      subscriptions,
      notifications,
      snapshots,
      audit,
      systemClock,
      appConfig.renewalReminderDays,
      appConfig.inactivityGraceCycles,
    ),
  };
}

export const app = createApp();
