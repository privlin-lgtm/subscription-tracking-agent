import { EventType, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Clock, ExtractionAgent, ExtractionInput, ExtractionResult, GmailClient, TokenEncryptor } from "@/domain/ports";
import type {
  AuditRecord,
  EmailSnapshotRepository,
  NotificationRepository,
  ProcessedEmailRepository,
  UserRepository,
  VendorAliasRepository,
} from "@/domain/repositories";
import { InMemorySubscriptions } from "@/application/subscriptions/in-memory-subscriptions";
import { SubscriptionPipelineService } from "@/application/subscriptions/subscription-pipeline.service";
import {
  CANCELLATION_AMBIGUOUS,
  CANCELLATION_CONFIRMED,
  CURRENCY_SWITCH,
  DUPLICATE_RECEIPT,
  EXTRACTION_FAILURE,
  FUZZY_VENDOR_MATCH,
  LOW_CONFIDENCE_TRIAL,
  NEW_SUBSCRIPTION,
  NOT_SUBSCRIPTION,
  PRICE_INCREASE,
  RENEWAL,
  type PipelineFixture,
} from "@/application/subscriptions/pipeline.fixtures";

const USER_ID = "user_1";
const AUTO_APPLY_THRESHOLD = 0.85;
const FUZZY_THRESHOLD = 0.88;

class InMemoryProcessedEmails implements ProcessedEmailRepository {
  seen = new Map<string, string>();

  async exists(userId: string, gmailMessageId: string): Promise<boolean> {
    return this.seen.has(`${userId}:${gmailMessageId}`);
  }

  async record(input: {
    userId: string;
    gmailMessageId: string;
    gmailHistoryId: string;
    classification: string;
  }): Promise<void> {
    this.seen.set(`${input.userId}:${input.gmailMessageId}`, input.classification);
  }
}

class InMemoryVendorAliases implements VendorAliasRepository {
  constructor(private readonly rows: Array<{ alias: string; canonicalName: string }>) {}

  async findCanonical(alias: string): Promise<string | null> {
    return this.rows.find((row) => row.alias === alias)?.canonicalName ?? null;
  }

  async listCanonicalNames(): Promise<string[]> {
    return [...new Set(this.rows.map((row) => row.canonicalName))];
  }
}

class FixtureExtractor implements ExtractionAgent {
  constructor(private readonly bySubject: Map<string, ExtractionResult | "extraction_failure">) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const result = this.bySubject.get(input.subject);
    if (result === undefined || result === "extraction_failure") {
      throw new Error("extraction failed");
    }
    return result;
  }
}

function buildHarness(fixtures: PipelineFixture[]) {
  const extractionBySubject = new Map<string, ExtractionResult | "extraction_failure">(
    fixtures.map((f) => [f.message.subject, f.extraction]),
  );
  const auditRows: AuditRecord[] = [];
  const subscriptions = new InMemorySubscriptions(auditRows);
  const processedEmails = new InMemoryProcessedEmails();
  const notifications: NotificationRepository = {
    createIfAbsent: vi.fn(async () => true),
    listByUser: vi.fn(async () => []),
    markRead: vi.fn(async () => undefined),
  };
  const snapshots: EmailSnapshotRepository = {
    save: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    purgeExpired: vi.fn(async () => 0),
  };
  const vendorAliases = new InMemoryVendorAliases([
    { alias: "netflix", canonicalName: "Netflix" },
    { alias: "amazon prime video", canonicalName: "Amazon Prime Video" },
  ]);
  const gmail = {} as GmailClient;
  const encryptor = {} as TokenEncryptor;
  const clock: Clock = { now: () => new Date("2026-09-15T00:00:00Z") };
  const users = {} as UserRepository;

  const pipeline = new SubscriptionPipelineService({
    users,
    subscriptions,
    processedEmails,
    notifications,
    snapshots,
    vendorAliases,
    gmail,
    extractor: new FixtureExtractor(extractionBySubject),
    encryptor,
    clock,
    autoApplyThreshold: AUTO_APPLY_THRESHOLD,
    fuzzyThreshold: FUZZY_THRESHOLD,
    snapshotTtlDays: 30,
  });

  return { pipeline, subscriptions, processedEmails, notifications, auditRows };
}

describe("subscription pipeline (fixture-driven)", () => {
  it("creates a new ACTIVE subscription on first receipt, atomically with its event and audit entry", async () => {
    const { pipeline, subscriptions, processedEmails, auditRows } = buildHarness([NEW_SUBSCRIPTION]);

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");

    const created = [...subscriptions.records.values()];
    expect(created).toHaveLength(1);
    expect(created[0].status).toBe(SubscriptionStatus.ACTIVE);
    expect(created[0].vendorNormalized).toBe("Netflix");
    expect(subscriptions.events[0].eventType).toBe(EventType.CREATED);
    expect(await processedEmails.exists(USER_ID, NEW_SUBSCRIPTION.message.id)).toBe(true);
    // The subscription row, its CREATED event, and the audit entry are written by one
    // applyWrite call — see docs/phase6-database-review.md (D1).
    expect(auditRows).toEqual([
      expect.objectContaining({ userId: USER_ID, action: "subscription.pipeline.apply" }),
    ]);
  });

  it("treats a later renewal date as RENEWED, not a new subscription", async () => {
    const { pipeline, subscriptions } = buildHarness([NEW_SUBSCRIPTION, RENEWAL]);

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");
    await pipeline.processMessage(USER_ID, RENEWAL.message, "11");

    expect(subscriptions.records.size).toBe(1);
    const record = [...subscriptions.records.values()][0];
    expect(record.nextRenewalDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(subscriptions.events.map((e) => e.eventType)).toEqual([EventType.CREATED, EventType.RENEWED]);
  });

  it("detects a price increase, records history atomically, and notifies", async () => {
    const { pipeline, subscriptions, notifications, auditRows } = buildHarness([NEW_SUBSCRIPTION, PRICE_INCREASE]);

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");
    await pipeline.processMessage(USER_ID, PRICE_INCREASE.message, "11");

    const record = [...subscriptions.records.values()][0];
    expect(record.priceAmountCents).toBe(1999);
    expect(subscriptions.priceChanges).toHaveLength(1);
    expect(subscriptions.priceChanges[0]).toMatchObject({ oldAmountCents: 1549, newAmountCents: 1999 });
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PRICE_INCREASE" }),
    );
    // The updated price, its PRICE_CHANGED event, and the price-change row all come from the
    // same applyWrite call, so none of them can land without the others.
    expect(auditRows).toHaveLength(2);
  });

  it("treats a repeat receipt for the same period as a silent duplicate, not a new event", async () => {
    const { pipeline, subscriptions } = buildHarness([NEW_SUBSCRIPTION, DUPLICATE_RECEIPT]);

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");
    await pipeline.processMessage(USER_ID, DUPLICATE_RECEIPT.message, "11");

    expect(subscriptions.records.size).toBe(1);
    expect(subscriptions.events).toHaveLength(1);
  });

  it("never auto-merges a currency change across renewals — routes to pending review", async () => {
    const { pipeline, subscriptions } = buildHarness([NEW_SUBSCRIPTION, CURRENCY_SWITCH]);

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");
    await pipeline.processMessage(USER_ID, CURRENCY_SWITCH.message, "11");

    const records = [...subscriptions.records.values()];
    expect(records).toHaveLength(2);
    const original = records.find((r) => r.priceCurrency === "USD");
    const review = records.find((r) => r.status === SubscriptionStatus.PENDING_REVIEW);
    expect(original?.priceCurrency).toBe("USD");
    expect(review?.reviewReason).toBe("currency_mismatch_across_renewals");
  });

  it("holds a low-confidence extraction for manual review instead of auto-applying it", async () => {
    const { pipeline, subscriptions } = buildHarness([LOW_CONFIDENCE_TRIAL]);

    await pipeline.processMessage(USER_ID, LOW_CONFIDENCE_TRIAL.message, "10");

    const record = [...subscriptions.records.values()][0];
    expect(record.status).toBe(SubscriptionStatus.PENDING_REVIEW);
    expect(record.confidenceScore).toBeLessThan(AUTO_APPLY_THRESHOLD);
  });

  it("drops ordinary non-billing mail at the prefilter without calling the extractor", async () => {
    const { pipeline, subscriptions, processedEmails } = buildHarness([NOT_SUBSCRIPTION]);

    await pipeline.processMessage(USER_ID, NOT_SUBSCRIPTION.message, "10");

    expect(subscriptions.records.size).toBe(0);
    expect(await processedEmails.exists(USER_ID, NOT_SUBSCRIPTION.message.id)).toBe(true);
  });

  it("fails safe into pending review when the LLM call itself fails", async () => {
    const { pipeline, subscriptions } = buildHarness([EXTRACTION_FAILURE]);

    await pipeline.processMessage(USER_ID, EXTRACTION_FAILURE.message, "10");

    const record = [...subscriptions.records.values()][0];
    expect(record.status).toBe(SubscriptionStatus.PENDING_REVIEW);
    expect(record.reviewReason).toBe("extraction_failed");
  });

  it("routes a fuzzy (non-exact) vendor match to review instead of silently merging vendors", async () => {
    const { pipeline, subscriptions } = buildHarness([FUZZY_VENDOR_MATCH]);

    await pipeline.processMessage(USER_ID, FUZZY_VENDOR_MATCH.message, "10");

    const record = [...subscriptions.records.values()][0];
    expect(record.status).toBe(SubscriptionStatus.PENDING_REVIEW);
    expect(record.vendorNormalized).toBe("Amazon Prime Video");
  });

  it("auto-cancels an existing ACTIVE subscription on a high-confidence cancellation email", async () => {
    const { pipeline, subscriptions, auditRows } = buildHarness([NEW_SUBSCRIPTION, CANCELLATION_CONFIRMED]);

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");
    await pipeline.processMessage(USER_ID, CANCELLATION_CONFIRMED.message, "11");

    expect(subscriptions.records.size).toBe(1);
    const record = [...subscriptions.records.values()][0];
    expect(record.status).toBe(SubscriptionStatus.CANCELED);
    expect(subscriptions.events.map((e) => e.eventType)).toEqual([EventType.CREATED, EventType.CANCELED]);
    expect(auditRows.map((row) => row.action)).toEqual([
      "subscription.pipeline.apply",
      "subscription.pipeline.cancel",
    ]);
  });

  it("flags an existing subscription for review on a low-confidence cancellation signal, instead of auto-canceling", async () => {
    const { pipeline, subscriptions, notifications, auditRows } = buildHarness([NEW_SUBSCRIPTION, CANCELLATION_AMBIGUOUS]);

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");
    await pipeline.processMessage(USER_ID, CANCELLATION_AMBIGUOUS.message, "11");

    expect(subscriptions.records.size).toBe(1);
    const record = [...subscriptions.records.values()][0];
    expect(record.status).toBe(SubscriptionStatus.PENDING_REVIEW);
    expect(record.reviewReason).toBe("possible_cancellation_low_confidence");
    expect(notifications.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "PENDING_REVIEW" }),
    );
    expect(auditRows.at(-1)?.action).toBe("subscription.pipeline.flag_possible_cancellation");
  });

  it("is a no-op for a cancellation email with no matching active subscription", async () => {
    const { pipeline, subscriptions, processedEmails } = buildHarness([CANCELLATION_CONFIRMED]);

    await pipeline.processMessage(USER_ID, CANCELLATION_CONFIRMED.message, "10");

    expect(subscriptions.records.size).toBe(0);
    expect(await processedEmails.exists(USER_ID, CANCELLATION_CONFIRMED.message.id)).toBe(true);
  });

  it("skips messages already recorded in the processed-email ledger (idempotent re-sync)", async () => {
    const { pipeline, subscriptions, processedEmails } = buildHarness([NEW_SUBSCRIPTION]);
    await processedEmails.record({
      userId: USER_ID,
      gmailMessageId: NEW_SUBSCRIPTION.message.id,
      gmailHistoryId: "9",
      classification: "SUBSCRIPTION" as never,
    });

    await pipeline.processMessage(USER_ID, NEW_SUBSCRIPTION.message, "10");

    expect(subscriptions.records.size).toBe(0);
  });
});
