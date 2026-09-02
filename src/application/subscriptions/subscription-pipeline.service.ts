import { EmailClassification, EventType, SubscriptionStatus } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/domain/errors";
import { Money } from "@/domain/value-objects/money";
import { isIso4217 } from "@/shared/iso-4217";
import type { Clock, ExtractionAgent, GmailClient, TokenEncryptor } from "@/domain/ports";
import type {
  AuditRepository,
  CreateSubscriptionInput,
  EmailSnapshotRepository,
  NotificationRepository,
  ProcessedEmailRepository,
  SubscriptionRecord,
  SubscriptionRepository,
  UserRepository,
  VendorAliasRepository,
} from "@/domain/repositories";
import { calibrateConfidence } from "@/application/extraction/confidence-calibration";
import { passesSubscriptionPrefilter } from "@/application/gmail/gmail-prefilter";
import { matchSubscription } from "@/application/subscriptions/matching.service";
import { toBillingCycle, VendorNormalizationService } from "@/application/subscriptions/vendor-normalization.service";
import type { ExtractionResult } from "@/domain/ports";

type PipelineDeps = {
  users: UserRepository;
  subscriptions: SubscriptionRepository;
  processedEmails: ProcessedEmailRepository;
  audit: AuditRepository;
  notifications: NotificationRepository;
  snapshots: EmailSnapshotRepository;
  vendorAliases: VendorAliasRepository;
  gmail: GmailClient;
  extractor: ExtractionAgent;
  encryptor: TokenEncryptor;
  clock: Clock;
  autoApplyThreshold: number;
  fuzzyThreshold: number;
  snapshotTtlDays: number;
};

export class SubscriptionPipelineService {
  private readonly vendors: VendorNormalizationService;

  constructor(private readonly deps: PipelineDeps) {
    this.vendors = new VendorNormalizationService(deps.vendorAliases, deps.fuzzyThreshold);
  }

  async processMessage(userId: string, messageId: string, historyId: string): Promise<void> {
    if (await this.deps.processedEmails.exists(userId, messageId)) {
      return;
    }

    const user = await this.deps.users.findById(userId);
    if (!user?.gmailRefreshToken) {
      throw new ValidationError("Gmail is not connected");
    }

    const refreshToken = this.deps.encryptor.decrypt(user.gmailRefreshToken);
    const message = await this.deps.gmail.getMessage(refreshToken, messageId);

    if (!passesSubscriptionPrefilter({
      subject: message.subject,
      sender: message.sender,
      snippet: message.snippet,
    })) {
      await this.deps.processedEmails.record({
        userId,
        gmailMessageId: messageId,
        gmailHistoryId: historyId,
        classification: EmailClassification.NOT_SUBSCRIPTION,
      });
      return;
    }

    const expiresAt = new Date(this.deps.clock.now());
    expiresAt.setDate(expiresAt.getDate() + this.deps.snapshotTtlDays);
    await this.deps.snapshots.save({
      userId,
      gmailMessageId: messageId,
      subject: message.subject,
      sender: message.sender,
      bodyText: message.bodyText.slice(0, 8000),
      expiresAt,
    });

    let extraction: ExtractionResult;
    try {
      extraction = await this.deps.extractor.extract({
        subject: message.subject,
        sender: message.sender,
        bodyText: message.bodyText,
      });
    } catch {
      await this.createPendingReview(userId, messageId, historyId, {
        vendorRaw: message.sender,
        vendorNormalized: message.sender,
        reason: "extraction_failed",
      });
      return;
    }

    const vendor = await this.vendors.normalize(extraction.vendor);
    const calibrated = calibrateConfidence(
      extraction,
      {
        sender: message.sender,
        knownVendorMatch: vendor.kind === "exact",
      },
      this.deps.autoApplyThreshold,
    );

    const needsReview =
      !extraction.isSubscription ||
      calibrated.confidence < this.deps.autoApplyThreshold ||
      vendor.kind === "fuzzy" ||
      !isIso4217(extraction.currency);

    if (!extraction.isSubscription && calibrated.confidence >= this.deps.autoApplyThreshold) {
      await this.deps.processedEmails.record({
        userId,
        gmailMessageId: messageId,
        gmailHistoryId: historyId,
        classification: EmailClassification.NOT_SUBSCRIPTION,
      });
      return;
    }

    if (needsReview) {
      await this.createPendingReview(userId, messageId, historyId, {
        vendorRaw: extraction.vendor,
        vendorNormalized: vendor.canonical,
        reason: calibrated.reviewReason ?? "low_confidence",
        extraction,
        confidence: calibrated.confidence,
      });
      return;
    }

    const money = Money.fromMajor(extraction.priceAmount, extraction.currency);
    const candidates = await this.deps.subscriptions.findActiveByVendor(userId, vendor.canonical);
    const decision = matchSubscription({
      candidates,
      vendorNormalized: vendor.canonical,
      money,
      renewalDate: extraction.renewalDate,
    });

    if (decision.kind === "currency_mismatch") {
      await this.createPendingReview(userId, messageId, historyId, {
        vendorRaw: extraction.vendor,
        vendorNormalized: vendor.canonical,
        reason: "currency_mismatch_across_renewals",
        extraction,
        confidence: calibrated.confidence,
      });
      return;
    }

    if (decision.kind === "duplicate") {
      await this.deps.processedEmails.record({
        userId,
        gmailMessageId: messageId,
        gmailHistoryId: historyId,
        classification: EmailClassification.SUBSCRIPTION,
      });
      return;
    }

    if (decision.kind === "no_match") {
      const created = await this.deps.subscriptions.create({
        userId,
        vendorNormalized: vendor.canonical,
        vendorRaw: extraction.vendor,
        status: SubscriptionStatus.ACTIVE,
        priceAmountCents: money.amountCents,
        priceCurrency: money.currency,
        billingCycle: toBillingCycle(extraction.billingCycle),
        nextRenewalDate: extraction.renewalDate,
        lastSeenEmailId: messageId,
        confidenceScore: calibrated.confidence,
      });
      await this.deps.subscriptions.appendEvent({
        subscriptionId: created.id,
        eventType: EventType.CREATED,
        sourceEmailId: messageId,
        payload: extraction as unknown as object,
      });
    } else if (decision.kind === "renewal") {
      await this.deps.subscriptions.update(decision.subscription.id, {
        nextRenewalDate: extraction.renewalDate,
        lastSeenEmailId: messageId,
        status: SubscriptionStatus.ACTIVE,
        confidenceScore: calibrated.confidence,
      });
      await this.deps.subscriptions.appendEvent({
        subscriptionId: decision.subscription.id,
        eventType: EventType.RENEWED,
        sourceEmailId: messageId,
        payload: extraction as unknown as object,
      });
    } else {
      await this.deps.subscriptions.update(decision.subscription.id, {
        priceAmountCents: money.amountCents,
        nextRenewalDate: extraction.renewalDate,
        lastSeenEmailId: messageId,
        status: SubscriptionStatus.ACTIVE,
        confidenceScore: calibrated.confidence,
      });
      await this.deps.subscriptions.appendEvent({
        subscriptionId: decision.subscription.id,
        eventType: EventType.PRICE_CHANGED,
        sourceEmailId: messageId,
        payload: extraction as unknown as object,
      });
      await this.deps.subscriptions.recordPriceChange({
        subscriptionId: decision.subscription.id,
        oldAmountCents: decision.subscription.priceAmountCents,
        newAmountCents: money.amountCents,
        currency: money.currency,
        sourceEmailId: messageId,
      });
      await this.deps.notifications.createIfAbsent({
        userId,
        subscriptionId: decision.subscription.id,
        type: "PRICE_INCREASE",
        title: `Price change: ${vendor.canonical}`,
        body: `${vendor.canonical} changed from ${decision.subscription.priceAmountCents} to ${money.amountCents} ${money.currency} minor units.`,
        idempotencyKey: `price:${decision.subscription.id}:${messageId}`,
      });
    }

    await this.deps.processedEmails.record({
      userId,
      gmailMessageId: messageId,
      gmailHistoryId: historyId,
      classification: EmailClassification.SUBSCRIPTION,
    });
    await this.deps.audit.record({
      userId,
      action: "subscription.pipeline.apply",
      actor: "system",
      details: { messageId, vendor: vendor.canonical, decision: decision.kind },
    });
  }

  private async createPendingReview(
    userId: string,
    messageId: string,
    historyId: string,
    input: {
      vendorRaw: string;
      vendorNormalized: string;
      reason: string;
      extraction?: ExtractionResult;
      confidence?: number;
    },
  ): Promise<void> {
    const money = pendingReviewMoney(input.extraction);
    const recordInput: CreateSubscriptionInput = {
      userId,
      vendorNormalized: input.vendorNormalized,
      vendorRaw: input.vendorRaw,
      status: SubscriptionStatus.PENDING_REVIEW,
      priceAmountCents: money.amountCents,
      priceCurrency: money.currency,
      billingCycle: input.extraction ? toBillingCycle(input.extraction.billingCycle) : "CUSTOM",
      nextRenewalDate: input.extraction?.renewalDate ?? null,
      lastSeenEmailId: messageId,
      confidenceScore: input.confidence ?? 0,
      reviewReason: input.reason,
    };

    let created: SubscriptionRecord;
    try {
      created = await this.deps.subscriptions.create(recordInput);
    } catch {
      throw new ConflictError("Unable to create pending review item");
    }

    await this.deps.subscriptions.appendEvent({
      subscriptionId: created.id,
      eventType: EventType.CREATED,
      sourceEmailId: messageId,
      payload: { reason: input.reason, extraction: input.extraction ?? null },
    });
    await this.deps.processedEmails.record({
      userId,
      gmailMessageId: messageId,
      gmailHistoryId: historyId,
      classification: EmailClassification.AMBIGUOUS,
    });
    await this.deps.notifications.createIfAbsent({
      userId,
      subscriptionId: created.id,
      type: "PENDING_REVIEW",
      title: "Subscription needs review",
      body: `${input.vendorNormalized} was held for review (${input.reason}).`,
      idempotencyKey: `review:${created.id}`,
    });
  }
}

function pendingReviewMoney(extraction?: ExtractionResult): { amountCents: number; currency: string } {
  if (!extraction || !isIso4217(extraction.currency) || !(extraction.priceAmount > 0)) {
    return { amountCents: 0, currency: "USD" };
  }
  return {
    amountCents: Money.fromMajor(extraction.priceAmount, extraction.currency).amountCents,
    currency: extraction.currency.toUpperCase(),
  };
}

export class GmailSyncService {
  constructor(
    private readonly users: UserRepository,
    private readonly gmail: GmailClient,
    private readonly encryptor: TokenEncryptor,
    private readonly pipeline: SubscriptionPipelineService,
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  async syncUser(userId: string): Promise<{ processed: number }> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new NotFoundError("User", userId);
    }
    if (!user.gmailConnected || !user.gmailRefreshToken) {
      throw new ValidationError("Gmail is not connected");
    }

    const refreshToken = this.encryptor.decrypt(user.gmailRefreshToken);
    let messageIds: string[] = [];
    let latestHistoryId = user.gmailHistoryId ?? "";

    if (user.gmailHistoryId) {
      const history = await this.gmail.listHistory(refreshToken, user.gmailHistoryId);
      if (history.expired) {
        const after = new Date(this.clock.now());
        after.setMonth(after.getMonth() - 12);
        messageIds = await this.gmail.listMessagesLookback(refreshToken, after);
      } else {
        messageIds = history.messageIds;
        latestHistoryId = history.latestHistoryId;
      }
    } else {
      const after = new Date(this.clock.now());
      after.setMonth(after.getMonth() - 12);
      messageIds = await this.gmail.listMessagesLookback(refreshToken, after);
    }

    let processed = 0;
    for (const messageId of messageIds) {
      await this.pipeline.processMessage(userId, messageId, latestHistoryId || messageId);
      processed += 1;
    }

    if (latestHistoryId) {
      await this.users.updateHistoryId(userId, latestHistoryId);
    }

    return { processed };
  }

  async markDisconnected(userId: string): Promise<void> {
    await this.users.updateGmailConnection(userId, {
      gmailConnected: false,
      gmailRefreshToken: null,
      gmailDisconnectedAt: this.clock.now(),
    });
    await this.notifications.createIfAbsent({
      userId,
      type: "GMAIL_DISCONNECTED",
      title: "Gmail disconnected",
      body: "Reconnect Gmail to resume subscription scanning.",
      idempotencyKey: `gmail-disconnected:${userId}:${this.clock.now().toISOString().slice(0, 10)}`,
    });
  }
}
