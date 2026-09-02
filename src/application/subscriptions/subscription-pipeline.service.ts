import { EmailClassification, EventType, SubscriptionStatus } from "@prisma/client";
import type { Clock, ExtractionAgent, ExtractionResult, GmailClient, GmailMessage, TokenEncryptor } from "@/domain/ports";
import { Money } from "@/domain/value-objects/money";
import { isIso4217 } from "@/shared/iso-4217";
import { isKnownBillingSender } from "@/shared/constants";
import { ConflictError } from "@/domain/errors";
import type {
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
import {
  toBillingCycle,
  VendorNormalizationService,
  type VendorNormalization,
} from "@/application/subscriptions/vendor-normalization.service";

type PipelineDeps = {
  users: UserRepository;
  subscriptions: SubscriptionRepository;
  processedEmails: ProcessedEmailRepository;
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

  async processMessage(userId: string, message: GmailMessage, historyId: string): Promise<void> {
    if (await this.deps.processedEmails.exists(userId, message.id)) {
      return;
    }

    if (!passesSubscriptionPrefilter({
      subject: message.subject,
      sender: message.sender,
      snippet: message.snippet,
    })) {
      await this.deps.processedEmails.record({
        userId,
        gmailMessageId: message.id,
        gmailHistoryId: historyId,
        classification: EmailClassification.NOT_SUBSCRIPTION,
      });
      return;
    }

    const expiresAt = new Date(this.deps.clock.now());
    expiresAt.setDate(expiresAt.getDate() + this.deps.snapshotTtlDays);
    await this.deps.snapshots.save({
      userId,
      gmailMessageId: message.id,
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
      await this.createPendingReview(userId, message.id, historyId, {
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

    if (extraction.isCancellation) {
      await this.handleCancellation(userId, message, historyId, vendor, extraction, calibrated);
      return;
    }

    const needsReview =
      !extraction.isSubscription ||
      calibrated.confidence < this.deps.autoApplyThreshold ||
      vendor.kind === "fuzzy" ||
      !isIso4217(extraction.currency);

    if (!extraction.isSubscription && calibrated.confidence >= this.deps.autoApplyThreshold) {
      await this.deps.processedEmails.record({
        userId,
        gmailMessageId: message.id,
        gmailHistoryId: historyId,
        classification: EmailClassification.NOT_SUBSCRIPTION,
      });
      return;
    }

    if (needsReview) {
      await this.createPendingReview(userId, message.id, historyId, {
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
      await this.createPendingReview(userId, message.id, historyId, {
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
        gmailMessageId: message.id,
        gmailHistoryId: historyId,
        classification: EmailClassification.SUBSCRIPTION,
      });
      return;
    }

    const auditForDecision = {
      userId,
      action: "subscription.pipeline.apply",
      actor: "system" as const,
      details: { messageId: message.id, vendor: vendor.canonical, decision: decision.kind },
    };

    if (decision.kind === "no_match") {
      await this.deps.subscriptions.applyWrite({
        create: {
          userId,
          vendorNormalized: vendor.canonical,
          vendorRaw: extraction.vendor,
          status: SubscriptionStatus.ACTIVE,
          priceAmountCents: money.amountCents,
          priceCurrency: money.currency,
          billingCycle: toBillingCycle(extraction.billingCycle),
          nextRenewalDate: extraction.renewalDate,
          lastSeenEmailId: message.id,
          confidenceScore: calibrated.confidence,
        },
        events: [{ eventType: EventType.CREATED, sourceEmailId: message.id, payload: extraction as unknown as object }],
        audit: auditForDecision,
      });
    } else if (decision.kind === "renewal") {
      await this.deps.subscriptions.applyWrite({
        update: {
          id: decision.subscription.id,
          data: {
            billingCycle: toBillingCycle(extraction.billingCycle),
            nextRenewalDate: extraction.renewalDate,
            lastSeenEmailId: message.id,
            status: SubscriptionStatus.ACTIVE,
            confidenceScore: calibrated.confidence,
          },
        },
        events: [{ eventType: EventType.RENEWED, sourceEmailId: message.id, payload: extraction as unknown as object }],
        audit: auditForDecision,
      });
    } else {
      await this.deps.subscriptions.applyWrite({
        update: {
          id: decision.subscription.id,
          data: {
            priceAmountCents: money.amountCents,
            billingCycle: toBillingCycle(extraction.billingCycle),
            nextRenewalDate: extraction.renewalDate,
            lastSeenEmailId: message.id,
            status: SubscriptionStatus.ACTIVE,
            confidenceScore: calibrated.confidence,
          },
        },
        events: [{ eventType: EventType.PRICE_CHANGED, sourceEmailId: message.id, payload: extraction as unknown as object }],
        priceChange: {
          oldAmountCents: decision.subscription.priceAmountCents,
          newAmountCents: money.amountCents,
          currency: money.currency,
          sourceEmailId: message.id,
        },
        audit: auditForDecision,
      });
      await this.deps.notifications.createIfAbsent({
        userId,
        subscriptionId: decision.subscription.id,
        type: "PRICE_INCREASE",
        title: `Price change: ${vendor.canonical}`,
        body: `${vendor.canonical} changed from ${decision.subscription.priceAmountCents} to ${money.amountCents} ${money.currency} minor units.`,
        idempotencyKey: `price:${decision.subscription.id}:${message.id}`,
      });
    }

    await this.deps.processedEmails.record({
      userId,
      gmailMessageId: message.id,
      gmailHistoryId: historyId,
      classification: EmailClassification.SUBSCRIPTION,
    });
  }

  /**
   * A cancellation confirmation matched against an existing ACTIVE subscription for this
   * vendor is auto-applied only when confidence is high, the vendor match is exact, AND the
   * sender is on the known-billing-domain allowlist — a wrongly-applied cancellation is worse
   * than a missed one, and vendor name alone is not proof of who actually sent the email (see
   * docs/phase8-security-review.md, S1). Anything less certain flags the existing record for
   * the user to confirm instead of creating a disconnected duplicate.
   */
  private async handleCancellation(
    userId: string,
    message: GmailMessage,
    historyId: string,
    vendor: VendorNormalization,
    extraction: ExtractionResult,
    calibrated: { confidence: number; reviewReason: string | null },
  ): Promise<void> {
    const candidates = await this.deps.subscriptions.findActiveByVendor(userId, vendor.canonical);
    const active = candidates.find((item) => item.status === SubscriptionStatus.ACTIVE);

    if (!active) {
      await this.deps.processedEmails.record({
        userId,
        gmailMessageId: message.id,
        gmailHistoryId: historyId,
        classification: EmailClassification.SUBSCRIPTION,
      });
      return;
    }

    const confidentCancellation =
      calibrated.confidence >= this.deps.autoApplyThreshold &&
      vendor.kind !== "fuzzy" &&
      isKnownBillingSender(message.sender);

    if (confidentCancellation) {
      await this.deps.subscriptions.applyWrite({
        update: { id: active.id, data: { status: SubscriptionStatus.CANCELED } },
        events: [{ eventType: EventType.CANCELED, sourceEmailId: message.id, payload: extraction as unknown as object }],
        audit: {
          userId,
          action: "subscription.pipeline.cancel",
          actor: "system",
          details: { messageId: message.id, subscriptionId: active.id, vendor: vendor.canonical },
        },
      });
      await this.deps.processedEmails.record({
        userId,
        gmailMessageId: message.id,
        gmailHistoryId: historyId,
        classification: EmailClassification.SUBSCRIPTION,
      });
      return;
    }

    await this.deps.subscriptions.applyWrite({
      update: {
        id: active.id,
        data: { status: SubscriptionStatus.PENDING_REVIEW, reviewReason: "possible_cancellation_low_confidence" },
      },
      audit: {
        userId,
        action: "subscription.pipeline.flag_possible_cancellation",
        actor: "system",
        details: { messageId: message.id, subscriptionId: active.id, vendor: vendor.canonical },
      },
    });
    await this.deps.processedEmails.record({
      userId,
      gmailMessageId: message.id,
      gmailHistoryId: historyId,
      classification: EmailClassification.AMBIGUOUS,
    });
    await this.deps.notifications.createIfAbsent({
      userId,
      subscriptionId: active.id,
      type: "PENDING_REVIEW",
      title: `Possible cancellation: ${vendor.canonical}`,
      body: `We think ${vendor.canonical} may have been canceled. Confirm to keep it active, or dismiss to stop tracking it.`,
      idempotencyKey: `cancel-review:${active.id}:${message.id}`,
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
      created = await this.deps.subscriptions.applyWrite({
        create: recordInput,
        events: [
          {
            eventType: EventType.CREATED,
            sourceEmailId: messageId,
            payload: { reason: input.reason, extraction: input.extraction ?? null },
          },
        ],
      });
    } catch {
      throw new ConflictError("Unable to create pending review item");
    }

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
