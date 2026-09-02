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
});
