import { appConfig } from "@/shared/config";
import { AlertJobs } from "@/application/alerts/alert.jobs";
import { DisplayCurrencyService } from "@/application/fx/display-currency.service";
import { FxRateJob } from "@/application/fx/fx-rate.job";
import { RegisterService } from "@/application/auth/register.service";
import { ReviewService, SubscriptionService } from "@/application/subscriptions/subscription.service";
import { SubscriptionPipelineService } from "@/application/subscriptions/subscription-pipeline.service";
import { GmailSyncService } from "@/application/gmail/gmail-sync.service";
import { AesGcmTokenEncryptor } from "@/infrastructure/crypto/token-encryption";
import {
  PrismaAuditRepository,
  PrismaCurrencyUsageRepository,
  PrismaEmailSnapshotRepository,
  PrismaExchangeRateRepository,
  PrismaNotificationRepository,
  PrismaProcessedEmailRepository,
  PrismaReviewRepository,
  PrismaSubscriptionRepository,
  PrismaUserPreferencesRepository,
  PrismaUserRepository,
  PrismaVendorAliasRepository,
} from "@/infrastructure/db/repositories";
import { FrankfurterRateProvider } from "@/infrastructure/fx/frankfurter.provider";
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
  // Deliberately no fallback to authSecret: reusing the session-signing secret to encrypt
  // Gmail refresh tokens would mean a compromise of either one compromises both, and would
  // silently invalidate stored tokens on an unrelated authSecret rotation. Misconfiguration
  // fails clearly (AesGcmTokenEncryptor throws) the first time a token is actually encrypted
  // or decrypted, rather than degrading security silently — see docs/phase8-security-review.md, S3.
  const encryptor = new AesGcmTokenEncryptor(appConfig.tokenEncryptionKey);
  const gmail = new GoogleGmailClient();
  const extractor = new OpenAiCompatibleExtractor();
  const locks = new PostgresAdvisoryLock();
  const exchangeRates = new PrismaExchangeRateRepository();
  const displayCurrency = new DisplayCurrencyService(
    new PrismaUserPreferencesRepository(),
    audit,
    appConfig.fx.defaultDisplayCurrency,
  );

  const pipeline = new SubscriptionPipelineService({
    users,
    subscriptions,
    processedEmails,
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
    displayCurrency,
    subscriptionService: new SubscriptionService(subscriptions, audit, {
      rates: exchangeRates,
      displayCurrencyFor: (userId) => displayCurrency.get(userId),
      clock: systemClock,
      baseCurrency: appConfig.fx.defaultDisplayCurrency,
      maxRateAgeDays: appConfig.fx.maxRateAgeDays,
    }),
    fxRateJob: new FxRateJob(
      new FrankfurterRateProvider(appConfig.fx.apiBaseUrl),
      exchangeRates,
      new PrismaCurrencyUsageRepository(),
      systemClock,
      appConfig.fx.defaultDisplayCurrency,
    ),
    reviewService: new ReviewService(subscriptions, reviews),
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
      appConfig.auditLogRetentionDays,
    ),
  };
}

export const app = createApp();
