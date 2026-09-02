import { EventType, ReviewDecisionType, SubscriptionStatus } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/domain/errors";
import { Money } from "@/domain/value-objects/money";
import { normalizeVendorKey, titleCaseVendor } from "@/domain/value-objects/vendor-name";
import type {
  AuditRecord,
  AuditRepository,
  PriceChangeRecord,
  ReviewRepository,
  SubscriptionEventInput,
  SubscriptionEventRecord,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionUpdate,
} from "@/domain/repositories";
import { summarizeSpend, type SpendSummary } from "@/application/reporting/spend-summary.service";
import { toBillingCycle } from "@/application/subscriptions/vendor-normalization.service";

export type ManualSubscriptionInput = {
  vendor?: string;
  priceAmount?: number;
  currency?: string;
  billingCycle?: "weekly" | "monthly" | "annual" | "custom" | "unknown";
  nextRenewalDate?: string | null;
};

export type SubscriptionDetail = {
  item: SubscriptionRecord;
  events: SubscriptionEventRecord[];
  priceChanges: PriceChangeRecord[];
};

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

  async getDetail(userId: string, id: string): Promise<SubscriptionDetail> {
    const item = await this.get(userId, id);
    const [events, priceChanges] = await Promise.all([
      this.subscriptions.listEvents(id),
      this.subscriptions.listPriceChanges(id),
    ]);
    return { item, events, priceChanges };
  }

  async spendSummary(userId: string): Promise<SpendSummary> {
    const items = await this.subscriptions.listByUser(userId);
    return summarizeSpend(items);
  }

  listUpcomingRenewals(userId: string, days = 30): Promise<SubscriptionRecord[]> {
    if (!Number.isFinite(days) || days < 1 || days > 365) {
      throw new ValidationError("Renewal window must be between 1 and 365 days");
    }
    const from = new Date();
    const to = new Date(from);
    to.setDate(to.getDate() + days);
    return this.subscriptions.listDueRenewals(userId, from, to);
  }

  listAudit(userId: string, limit = 50): Promise<AuditRecord[]> {
    return this.audit.listByUser(userId, limit);
  }

  async create(userId: string, input: ManualSubscriptionInput): Promise<SubscriptionRecord> {
    const vendorRaw = input.vendor?.trim() ?? "";
    if (!vendorRaw) {
      throw new ValidationError("Vendor is required");
    }
    if (input.priceAmount === undefined || !input.currency) {
      throw new ValidationError("Price and currency are required");
    }
    if (!input.billingCycle) {
      throw new ValidationError("Billing cycle is required");
    }

    const money = Money.fromMajor(input.priceAmount, input.currency);
    const vendorNormalized = titleCaseVendor(normalizeVendorKey(vendorRaw) || vendorRaw);
    const nextRenewalDate = parseOptionalDate(input.nextRenewalDate);

    return this.subscriptions.applyWrite({
      create: {
        userId,
        vendorNormalized,
        vendorRaw,
        status: SubscriptionStatus.ACTIVE,
        priceAmountCents: money.amountCents,
        priceCurrency: money.currency,
        billingCycle: toBillingCycle(input.billingCycle),
        nextRenewalDate,
        lastSeenEmailId: null,
        confidenceScore: 1,
      },
      events: [{ eventType: EventType.CREATED, payload: { source: "manual", input } }],
      audit: {
        userId,
        action: "subscription.create",
        actor: "user",
        details: { vendorNormalized, source: "manual" },
      },
    });
  }

  async update(userId: string, id: string, input: ManualSubscriptionInput): Promise<SubscriptionRecord> {
    const item = await this.get(userId, id);
    const data: SubscriptionUpdate = {};
    const events: SubscriptionEventInput[] = [];
    let priceChange: { oldAmountCents: number; newAmountCents: number; currency: string } | undefined;

    if (input.vendor !== undefined) {
      const vendorRaw = input.vendor.trim();
      if (!vendorRaw) {
        throw new ValidationError("Vendor is required");
      }
      data.vendorRaw = vendorRaw;
      data.vendorNormalized = titleCaseVendor(normalizeVendorKey(vendorRaw) || vendorRaw);
    }

    if (input.billingCycle !== undefined) {
      data.billingCycle = toBillingCycle(input.billingCycle);
    }

    if (input.nextRenewalDate !== undefined) {
      data.nextRenewalDate = parseOptionalDate(input.nextRenewalDate);
    }

    if (input.priceAmount !== undefined || input.currency !== undefined) {
      const money = Money.fromMajor(
        input.priceAmount ?? item.priceAmountCents / 100,
        input.currency ?? item.priceCurrency,
      );
      data.priceAmountCents = money.amountCents;
      data.priceCurrency = money.currency;
      if (money.amountCents !== item.priceAmountCents || money.currency !== item.priceCurrency) {
        priceChange = {
          oldAmountCents: item.priceAmountCents,
          newAmountCents: money.amountCents,
          currency: money.currency,
        };
        events.push({
          eventType: EventType.PRICE_CHANGED,
          payload: {
            oldAmountCents: item.priceAmountCents,
            newAmountCents: money.amountCents,
            oldCurrency: item.priceCurrency,
            newCurrency: money.currency,
          },
        });
      }
    }

    const renewalChanged =
      input.nextRenewalDate !== undefined &&
      (item.nextRenewalDate?.toISOString() ?? null) !== (data.nextRenewalDate?.toISOString() ?? null);
    if (renewalChanged) {
      events.push({
        eventType: EventType.RENEWED,
        payload: {
          previousRenewalDate: item.nextRenewalDate?.toISOString() ?? null,
          nextRenewalDate: data.nextRenewalDate?.toISOString() ?? null,
          source: "manual",
        },
      });
    }

    const vendorChanged =
      (data.vendorNormalized !== undefined && data.vendorNormalized !== item.vendorNormalized) ||
      (data.vendorRaw !== undefined && data.vendorRaw !== item.vendorRaw);
    const cycleChanged = data.billingCycle !== undefined && data.billingCycle !== item.billingCycle;
    if (vendorChanged || cycleChanged) {
      events.push({
        eventType: EventType.UPDATED,
        payload: {
          vendorNormalized: data.vendorNormalized ?? item.vendorNormalized,
          billingCycle: data.billingCycle ?? item.billingCycle,
        },
      });
    }

    if (events.length === 0) {
      if (
        input.vendor === undefined &&
        input.priceAmount === undefined &&
        input.currency === undefined &&
        input.billingCycle === undefined &&
        input.nextRenewalDate === undefined
      ) {
        throw new ValidationError("No subscription changes were provided");
      }
      return item;
    }

    return this.subscriptions.applyWrite({
      update: { id, data },
      events,
      priceChange,
      audit: {
        userId,
        action: "subscription.update",
        actor: "user",
        details: { subscriptionId: id, fields: Object.keys(data) },
      },
    });
  }

  async cancel(userId: string, id: string): Promise<SubscriptionRecord> {
    const item = await this.get(userId, id);
    if (item.status === SubscriptionStatus.CANCELED) {
      throw new ValidationError("Subscription is already canceled");
    }
    return this.subscriptions.applyWrite({
      update: { id, data: { status: SubscriptionStatus.CANCELED } },
      events: [{ eventType: EventType.CANCELED, payload: { previousStatus: item.status } }],
      audit: {
        userId,
        action: "subscription.cancel",
        actor: "user",
        details: { subscriptionId: id },
      },
    });
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
    const edited = Boolean(
      input.vendorNormalized || input.priceAmount || input.currency || input.billingCycle || input.nextRenewalDate !== undefined,
    );

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

function parseOptionalDate(value?: string | null): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError("Renewal date must be a valid date");
  }
  return parsed;
}
