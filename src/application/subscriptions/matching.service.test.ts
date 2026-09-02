import { describe, expect, it } from "vitest";
import { Money } from "@/domain/value-objects/money";
import { matchSubscription } from "@/application/subscriptions/matching.service";
import type { SubscriptionRecord } from "@/domain/repositories";

function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub_1",
    userId: "user_1",
    vendorNormalized: "Netflix",
    vendorRaw: "NETFLIX.COM",
    status: "ACTIVE",
    priceAmountCents: 1549,
    priceCurrency: "USD",
    billingCycle: "MONTHLY",
    nextRenewalDate: new Date("2026-10-02"),
    lastSeenEmailId: "msg_1",
    confidenceScore: 0.9,
    reviewReason: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("subscription matching", () => {
  it("detects a duplicate receipt for the same period", () => {
    const decision = matchSubscription({
      candidates: [record()],
      vendorNormalized: "Netflix",
      money: new Money(1549, "USD"),
      renewalDate: new Date("2026-10-02"),
    });
    expect(decision.kind).toBe("duplicate");
  });

  it("detects a renewal when the date moves forward", () => {
    const decision = matchSubscription({
      candidates: [record()],
      vendorNormalized: "Netflix",
      money: new Money(1549, "USD"),
      renewalDate: new Date("2026-11-02"),
    });
    expect(decision.kind).toBe("renewal");
  });

  it("detects a price change in the same currency", () => {
    const decision = matchSubscription({
      candidates: [record()],
      vendorNormalized: "Netflix",
      money: new Money(1999, "USD"),
      renewalDate: new Date("2026-11-02"),
    });
    expect(decision.kind).toBe("price_change");
  });

  it("does not auto-merge a currency mismatch", () => {
    const decision = matchSubscription({
      candidates: [record()],
      vendorNormalized: "Netflix",
      money: new Money(1549, "EUR"),
      renewalDate: new Date("2026-11-02"),
    });
    expect(decision.kind).toBe("currency_mismatch");
  });
});
