import { EventType, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";
import { SubscriptionService } from "@/application/subscriptions/subscription.service";
import { NotFoundError, ValidationError } from "@/domain/errors";

const USER_ID = "user_1";

function service() {
  const { subscriptions, audit } = createInMemoryPersistence();
  return { subscriptions, audit, svc: new SubscriptionService(subscriptions, audit) };
}

describe("SubscriptionService persistence", () => {
  it("creates a subscription with a CREATED event and audit row in one write", async () => {
    const { svc, subscriptions, audit } = service();

    const item = await svc.create(USER_ID, {
      vendor: "netflix",
      priceAmount: 15.49,
      currency: "usd",
      billingCycle: "monthly",
      nextRenewalDate: "2026-10-01",
    });

    expect(item.vendorNormalized).toBe("Netflix");
    expect(item.status).toBe(SubscriptionStatus.ACTIVE);
    expect(item.priceAmountCents).toBe(1549);
    expect(item.priceCurrency).toBe("USD");
    expect(item.confidenceScore).toBe(1);

    const detail = await svc.getDetail(USER_ID, item.id);
    expect(detail.events.map((event) => event.eventType)).toEqual([EventType.CREATED]);
    expect(await audit.listByUser(USER_ID)).toEqual([
      expect.objectContaining({ action: "subscription.create", actor: "user" }),
    ]);
    expect(subscriptions.records.size).toBe(1);
  });

  it("records PRICE_CHANGED and a price-change row when the amount changes", async () => {
    const { svc } = service();
    const created = await svc.create(USER_ID, {
      vendor: "Spotify",
      priceAmount: 10,
      currency: "USD",
      billingCycle: "monthly",
    });

    const updated = await svc.update(USER_ID, created.id, { priceAmount: 12 });
    expect(updated.priceAmountCents).toBe(1200);

    const detail = await svc.getDetail(USER_ID, created.id);
    expect(detail.events.map((event) => event.eventType)).toContain(EventType.PRICE_CHANGED);
    expect(detail.priceChanges).toEqual([
      expect.objectContaining({ oldAmountCents: 1000, newAmountCents: 1200, currency: "USD" }),
    ]);
  });

  it("records RENEWED when the next renewal date changes", async () => {
    const { svc } = service();
    const created = await svc.create(USER_ID, {
      vendor: "Spotify",
      priceAmount: 10,
      currency: "USD",
      billingCycle: "monthly",
      nextRenewalDate: "2026-10-01",
    });

    await svc.update(USER_ID, created.id, { nextRenewalDate: "2026-11-01" });

    const detail = await svc.getDetail(USER_ID, created.id);
    expect(detail.events.map((event) => event.eventType)).toContain(EventType.RENEWED);
    expect(detail.item.nextRenewalDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("records UPDATED when vendor or billing cycle changes", async () => {
    const { svc } = service();
    const created = await svc.create(USER_ID, {
      vendor: "Hulu",
      priceAmount: 18,
      currency: "USD",
      billingCycle: "monthly",
    });

    await svc.update(USER_ID, created.id, { billingCycle: "annual" });

    const detail = await svc.getDetail(USER_ID, created.id);
    expect(detail.events.map((event) => event.eventType)).toContain(EventType.UPDATED);
    expect(detail.item.billingCycle).toBe("ANNUAL");
  });

  it("cancels transactionally with a CANCELED event", async () => {
    const { svc } = service();
    const created = await svc.create(USER_ID, {
      vendor: "Hulu",
      priceAmount: 18,
      currency: "USD",
      billingCycle: "monthly",
    });

    const canceled = await svc.cancel(USER_ID, created.id);
    expect(canceled.status).toBe(SubscriptionStatus.CANCELED);
    const detail = await svc.getDetail(USER_ID, created.id);
    expect(detail.events.map((event) => event.eventType)).toContain(EventType.CANCELED);
    await expect(svc.cancel(USER_ID, created.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists upcoming renewals inside the requested window", async () => {
    const { svc } = service();
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    const later = new Date();
    later.setDate(later.getDate() + 60);

    await svc.create(USER_ID, {
      vendor: "Soon",
      priceAmount: 9,
      currency: "USD",
      billingCycle: "monthly",
      nextRenewalDate: soon.toISOString(),
    });
    await svc.create(USER_ID, {
      vendor: "Later",
      priceAmount: 9,
      currency: "USD",
      billingCycle: "monthly",
      nextRenewalDate: later.toISOString(),
    });

    const upcoming = await svc.listUpcomingRenewals(USER_ID, 30);
    expect(upcoming.map((item) => item.vendorNormalized)).toEqual(["Soon"]);
  });

  it("rejects unknown subscriptions and empty updates", async () => {
    const { svc } = service();
    await expect(svc.get(USER_ID, "missing")).rejects.toBeInstanceOf(NotFoundError);
    const created = await svc.create(USER_ID, {
      vendor: "Hulu",
      priceAmount: 18,
      currency: "USD",
      billingCycle: "monthly",
    });
    await expect(svc.update(USER_ID, created.id, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.create(USER_ID, { vendor: "", priceAmount: 1, currency: "USD", billingCycle: "monthly" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects an unparseable renewal date", async () => {
    const { svc } = service();
    await expect(
      svc.create(USER_ID, { vendor: "Hulu", priceAmount: 18, currency: "USD", billingCycle: "monthly", nextRenewalDate: "not-a-date" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("converts existing minor units correctly for a currency-only edit on a zero-decimal currency", async () => {
    // Regression test: a currency-only edit used to recompute the existing amount as
    // priceAmountCents / 100, which is wrong for a currency like JPY where 1 minor unit
    // equals 1 major unit, not 1/100.
    const { svc } = service();
    const created = await svc.create(USER_ID, { vendor: "Netflix", priceAmount: 1500, currency: "JPY", billingCycle: "monthly" });
    expect(created.priceAmountCents).toBe(1500);

    const updated = await svc.update(USER_ID, created.id, { currency: "USD" });
    // 1500 JPY minor units = 1500 major units; re-expressed in USD (2-decimal) that's 150000 cents.
    expect(updated.priceAmountCents).toBe(150000);
    expect(updated.priceCurrency).toBe("USD");
  });

  it("scopes reads to the owning user", async () => {
    const { svc } = service();
    const created = await svc.create(USER_ID, {
      vendor: "Hulu",
      priceAmount: 18,
      currency: "USD",
      billingCycle: "monthly",
    });
    await expect(svc.get("other", created.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("scopes history reads to the owning user at the repository layer too (defense in depth)", async () => {
    const { svc, subscriptions } = service();
    const created = await svc.create(USER_ID, {
      vendor: "Hulu",
      priceAmount: 18,
      currency: "USD",
      billingCycle: "monthly",
    });

    expect(await subscriptions.listEvents("other", created.id)).toEqual([]);
    expect(await subscriptions.listPriceChanges("other", created.id)).toEqual([]);
    expect(await subscriptions.listEvents(USER_ID, created.id)).not.toEqual([]);
  });

  it("excludes CANCELED and PENDING_REVIEW subscriptions from the spend summary query itself", async () => {
    const { svc, subscriptions } = service();
    await svc.create(USER_ID, { vendor: "Active", priceAmount: 10, currency: "USD", billingCycle: "monthly" });
    const toCancel = await svc.create(USER_ID, {
      vendor: "Canceled",
      priceAmount: 20,
      currency: "USD",
      billingCycle: "monthly",
    });
    await svc.cancel(USER_ID, toCancel.id);

    const summary = await svc.spendSummary(USER_ID);
    expect(summary).toEqual({ mixed: false, currency: "USD", totalCents: 1000, subscriptionCount: 1 });

    const fetched = await subscriptions.listByUser(USER_ID, [SubscriptionStatus.ACTIVE, SubscriptionStatus.INACTIVE]);
    expect(fetched.map((item) => item.vendorNormalized)).toEqual(["Active"]);
  });
});
