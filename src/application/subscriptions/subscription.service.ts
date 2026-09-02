import { EventType, ReviewDecisionType, SubscriptionStatus } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/domain/errors";
import { Money } from "@/domain/value-objects/money";
import type {
  AuditRepository,
  ReviewRepository,
  SubscriptionRecord,
  SubscriptionRepository,
} from "@/domain/repositories";
import { summarizeSpend, type SpendSummary } from "@/application/reporting/spend-summary.service";
import { toBillingCycle } from "@/application/subscriptions/vendor-normalization.service";

export class SubscriptionService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly audit: AuditRepository,
  ) {}

  list(userId: string): Promise<SubscriptionRecord[]> {
    return this.subscriptions.listByUser(userId);
  }

  async get(userId: string, id: string): Promise<SubscriptionRecord> {
    const item = await this.subscriptions.getByIdForUser(userId, id);
    if (!item) {
      throw new NotFoundError("Subscription", id);
    }
    return item;
  }

  async spendSummary(userId: string): Promise<SpendSummary> {
    const items = await this.subscriptions.listByUser(userId);
    return summarizeSpend(items);
  }

  async cancel(userId: string, id: string): Promise<SubscriptionRecord> {
    const item = await this.get(userId, id);
    const updated = await this.subscriptions.update(id, { status: SubscriptionStatus.CANCELED });
    await this.subscriptions.appendEvent({
      subscriptionId: id,
      eventType: EventType.CANCELED,
      payload: { previousStatus: item.status },
    });
    await this.audit.record({
      userId,
      action: "subscription.cancel",
      actor: "user",
      details: { subscriptionId: id },
    });
    return updated;
  }
}

export type ReviewConfirmInput = {
  vendorNormalized?: string;
  priceAmount?: number;
  currency?: string;
  billingCycle?: "weekly" | "monthly" | "annual" | "custom" | "unknown";
  nextRenewalDate?: string | null;
  notes?: string;
};

export class ReviewService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly reviews: ReviewRepository,
    private readonly audit: AuditRepository,
  ) {}

  listPending(userId: string): Promise<SubscriptionRecord[]> {
    return this.subscriptions.listByUser(userId, SubscriptionStatus.PENDING_REVIEW);
  }

  async confirm(userId: string, id: string, input: ReviewConfirmInput = {}): Promise<SubscriptionRecord> {
    const item = await this.requirePending(userId, id);
    const edited = Boolean(input.vendorNormalized || input.priceAmount || input.currency || input.billingCycle || input.nextRenewalDate !== undefined);

    let priceAmountCents = item.priceAmountCents;
    let priceCurrency = item.priceCurrency;
    if (input.priceAmount !== undefined || input.currency) {
      const money = Money.fromMajor(input.priceAmount ?? item.priceAmountCents / 100, input.currency ?? item.priceCurrency);
      priceAmountCents = money.amountCents;
      priceCurrency = money.currency;
    }

    const updated = await this.subscriptions.update(id, {
      status: SubscriptionStatus.ACTIVE,
      vendorNormalized: input.vendorNormalized ?? item.vendorNormalized,
      priceAmountCents,
      priceCurrency,
      billingCycle: input.billingCycle ? toBillingCycle(input.billingCycle) : item.billingCycle,
      nextRenewalDate: input.nextRenewalDate ? new Date(input.nextRenewalDate) : item.nextRenewalDate,
      reviewReason: null,
    });

    await this.subscriptions.appendEvent({
      subscriptionId: id,
      eventType: EventType.REVIEW_CONFIRMED,
      payload: { edited, input },
    });
    await this.reviews.recordDecision({
      subscriptionId: id,
      userId,
      decision: edited ? ReviewDecisionType.EDIT_AND_CONFIRM : ReviewDecisionType.CONFIRM,
      notes: input.notes,
      editedPayload: edited ? (input as object) : undefined,
    });
    await this.audit.record({
      userId,
      action: "review.confirm",
      actor: "user",
      details: { subscriptionId: id, edited },
    });
    return updated;
  }

  async dismiss(userId: string, id: string, notes?: string): Promise<SubscriptionRecord> {
    await this.requirePending(userId, id);
    const updated = await this.subscriptions.update(id, {
      status: SubscriptionStatus.DISMISSED,
      reviewReason: notes ?? "dismissed_by_user",
    });
    await this.subscriptions.appendEvent({
      subscriptionId: id,
      eventType: EventType.REVIEW_DISMISSED,
      payload: { notes: notes ?? null },
    });
    await this.reviews.recordDecision({
      subscriptionId: id,
      userId,
      decision: ReviewDecisionType.DISMISS,
      notes,
    });
    await this.audit.record({
      userId,
      action: "review.dismiss",
      actor: "user",
      details: { subscriptionId: id },
    });
    return updated;
  }

  private async requirePending(userId: string, id: string): Promise<SubscriptionRecord> {
    const item = await this.subscriptions.getByIdForUser(userId, id);
    if (!item) {
      throw new NotFoundError("Subscription", id);
    }
    if (item.status !== SubscriptionStatus.PENDING_REVIEW) {
      throw new ValidationError("Only pending review items can be resolved");
    }
    return item;
  }
}
