import { SubscriptionStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { Clock, ExtractionAgent, ExtractionInput, ExtractionResult, GmailClient, TokenEncryptor } from "@/domain/ports";
import type {
  EmailSnapshotRepository,
  NotificationRepository,
  ProcessedEmailRepository,
  SubscriptionRecord,
  UserRepository,
  VendorAliasRepository,
} from "@/domain/repositories";
import { InMemorySubscriptions } from "@/application/subscriptions/in-memory-subscriptions";
import { SubscriptionPipelineService } from "@/application/subscriptions/subscription-pipeline.service";
import {
  ADVERSARIAL_FIXTURES,
  type AdversarialFixture,
  type ExpectedOutcome,
} from "@/application/subscriptions/adversarial.fixtures";

/**
 * Phase 7 "Data Quality Validation" support: runs all 100 adversarial fixtures through the
 * real SubscriptionPipelineService (no mocked business logic — only the LLM call is faked,
 * returning each fixture's ground-truth `extraction`) and checks the pipeline reaches the
 * expected outcome. Results are summarized in docs/phase7-data-quality-validation.md.
 */

const USER_ID = "adv_user";
const AUTO_APPLY_THRESHOLD = 0.85;
const FUZZY_THRESHOLD = 0.88;
const NOW = new Date("2026-09-10T00:00:00Z");

class InMemoryProcessedEmails implements ProcessedEmailRepository {
  seen = new Map<string, string>();
  async exists(userId: string, gmailMessageId: string): Promise<boolean> {
    return this.seen.has(`${userId}:${gmailMessageId}`);
  }
  async record(input: { userId: string; gmailMessageId: string; gmailHistoryId: string; classification: string }): Promise<void> {
    this.seen.set(`${input.userId}:${input.gmailMessageId}`, input.classification);
  }
}

class NoopVendorAliases implements VendorAliasRepository {
  async findCanonical(): Promise<string | null> {
    return null;
  }
  async listCanonicalNames(): Promise<string[]> {
    return [];
  }
}

class SingleFixtureExtractor implements ExtractionAgent {
  constructor(
    private readonly subject: string,
    private readonly result: ExtractionResult | "extraction_failure",
  ) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    if (input.subject !== this.subject || this.result === "extraction_failure") {
      throw new Error(`unexpected extraction call for subject: ${input.subject}`);
    }
    return this.result;
  }
}

function classifyOutcome(
  before: Map<string, SubscriptionRecord>,
  after: Map<string, SubscriptionRecord>,
  priorId?: string,
): ExpectedOutcome {
  const newRecords = [...after.values()].filter((record) => !before.has(record.id));
  if (newRecords.length === 1) {
    return newRecords[0].status === SubscriptionStatus.PENDING_REVIEW ? "pending_review" : "created";
  }
  if (newRecords.length === 0 && priorId) {
    const priorBefore = before.get(priorId)!;
    const priorAfter = after.get(priorId)!;
    if (priorAfter.priceAmountCents !== priorBefore.priceAmountCents) {
      return "price_changed";
    }
    const beforeTime = priorBefore.nextRenewalDate?.getTime() ?? null;
    const afterTime = priorAfter.nextRenewalDate?.getTime() ?? null;
    if (beforeTime !== afterTime) {
      return "renewed";
    }
    return "duplicate";
  }
  return "not_subscription";
}

async function runFixture(fixture: AdversarialFixture): Promise<{
  actual: ExpectedOutcome;
  finalRecord: SubscriptionRecord | undefined;
}> {
  const subscriptions = new InMemorySubscriptions();
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
  const clock: Clock = { now: () => NOW };
  const users = {} as UserRepository;
  const gmail = {} as GmailClient;
  const encryptor = {} as TokenEncryptor;

  let priorId: string | undefined;
  if (fixture.priorSubscription) {
    const created = await subscriptions.create({
      userId: USER_ID,
      vendorNormalized: fixture.priorSubscription.vendorNormalized,
      vendorRaw: fixture.priorSubscription.vendorNormalized,
      status: SubscriptionStatus.ACTIVE,
      priceAmountCents: fixture.priorSubscription.priceAmountCents,
      priceCurrency: fixture.priorSubscription.priceCurrency,
      billingCycle: fixture.priorSubscription.billingCycle,
      nextRenewalDate: fixture.priorSubscription.nextRenewalDate,
      lastSeenEmailId: "prior_msg",
      confidenceScore: 1,
    });
    priorId = created.id;
  }

  const pipeline = new SubscriptionPipelineService({
    users,
    subscriptions,
    processedEmails,
    notifications,
    snapshots,
    vendorAliases: new NoopVendorAliases(),
    gmail,
    extractor: new SingleFixtureExtractor(fixture.message.subject, fixture.extraction),
    encryptor,
    clock,
    autoApplyThreshold: AUTO_APPLY_THRESHOLD,
    fuzzyThreshold: FUZZY_THRESHOLD,
    snapshotTtlDays: 30,
  });

  const before = new Map(subscriptions.records);
  await pipeline.processMessage(USER_ID, fixture.message, "1");
  const after = subscriptions.records;

  return {
    actual: classifyOutcome(before, after, priorId),
    finalRecord: priorId ? after.get(priorId) : [...after.values()][0],
  };
}

describe("Phase 7 adversarial email set (100 examples)", () => {
  it(`covers exactly 100 fixtures across all six categories`, () => {
    expect(ADVERSARIAL_FIXTURES).toHaveLength(100);
    const counts = new Map<string, number>();
    for (const fixture of ADVERSARIAL_FIXTURES) {
      counts.set(fixture.category, (counts.get(fixture.category) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      ambiguous_invoice: 17,
      trial_subscription: 17,
      international_currency: 17,
      mixed_language: 17,
      changed_pricing_model: 16,
      partial_renewal_notice: 16,
    });
  });

  it.each(ADVERSARIAL_FIXTURES)("$id ($category): expects $expectedOutcome", async (fixture) => {
    const { actual } = await runFixture(fixture);
    expect(actual).toBe(fixture.expectedOutcome);
  });

  it("updates billingCycle, not just price, when a renewal or price-change email reports a new cycle", async () => {
    const annualSwitch = ADVERSARIAL_FIXTURES.find((f) => f.id === "pricing-01")!;
    const { finalRecord } = await runFixture(annualSwitch);
    expect(finalRecord?.billingCycle).toBe("ANNUAL");
  });
});
