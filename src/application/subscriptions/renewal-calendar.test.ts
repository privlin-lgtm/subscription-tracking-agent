import { BillingCycle, SubscriptionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { SubscriptionRecord } from "@/domain/repositories";
import { createInMemoryPersistence } from "@/application/subscriptions/in-memory-subscriptions";
import { SubscriptionService } from "@/application/subscriptions/subscription.service";
import {
  addUtcMonthsClamped,
  buildCalendarMonth,
  formatMonthParam,
  parseMonthParam,
  projectRenewals,
  shiftMonth,
  totalsByCurrency,
} from "@/application/subscriptions/renewal-calendar";
import { ValidationError } from "@/domain/errors";

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return {
    id: "sub_1",
    userId: "user_1",
    vendorNormalized: "Netflix",
    vendorRaw: "netflix",
    status: SubscriptionStatus.ACTIVE,
    priceAmountCents: 1599,
    priceCurrency: "USD",
    billingCycle: BillingCycle.MONTHLY,
    nextRenewalDate: new Date("2026-11-15T00:00:00.000Z"),
    lastSeenEmailId: null,
    confidenceScore: 1,
    reviewReason: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("projectRenewals", () => {
  it("returns the stored date as actual and later monthly dates as projected", () => {
    const result = projectRenewals([subscription()], day("2026-11-01"), day("2027-01-31"));
    expect(result.map((item) => [item.dateKey, item.projected])).toEqual([
      ["2026-11-15", false],
      ["2026-12-15", true],
      ["2027-01-15", true],
    ]);
    expect(result[0]).toMatchObject({
      subscriptionId: "sub_1",
      vendor: "Netflix",
      amountCents: 1599,
      currency: "USD",
    });
  });

  it("clamps month-end dates and returns to the original day afterwards", () => {
    const result = projectRenewals(
      [subscription({ nextRenewalDate: day("2027-01-31") })],
      day("2027-01-01"),
      day("2027-04-30"),
    );
    expect(result.map((item) => item.dateKey)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("projects weekly and annual cycles", () => {
    const weekly = projectRenewals(
      [subscription({ billingCycle: BillingCycle.WEEKLY, nextRenewalDate: day("2026-11-02") })],
      day("2026-11-01"),
      day("2026-11-30"),
    );
    expect(weekly.map((item) => item.dateKey)).toEqual([
      "2026-11-02",
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
      "2026-11-30",
    ]);

    const annual = projectRenewals(
      [subscription({ billingCycle: BillingCycle.ANNUAL, nextRenewalDate: day("2024-02-29") })],
      day("2024-01-01"),
      day("2028-12-31"),
    );
    expect(annual.map((item) => item.dateKey)).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("shows only the stored date for custom cycles", () => {
    const result = projectRenewals(
      [subscription({ billingCycle: BillingCycle.CUSTOM })],
      day("2026-11-01"),
      day("2027-11-01"),
    );
    expect(result.map((item) => item.dateKey)).toEqual(["2026-11-15"]);
  });

  it("never projects backwards and skips subscriptions without a renewal date", () => {
    const result = projectRenewals(
      [subscription(), subscription({ id: "sub_2", nextRenewalDate: null })],
      day("2026-09-01"),
      day("2026-10-31"),
    );
    expect(result).toEqual([]);
  });

  it("uses the UTC calendar day of a stored timestamp and includes both range ends", () => {
    const result = projectRenewals(
      [subscription({ billingCycle: BillingCycle.CUSTOM, nextRenewalDate: new Date("2026-11-30T23:30:00.000Z") })],
      day("2026-11-30"),
      day("2026-11-30"),
    );
    expect(result.map((item) => item.dateKey)).toEqual(["2026-11-30"]);
  });

  it("sorts by day, then vendor", () => {
    const result = projectRenewals(
      [
        subscription({ id: "b", vendorNormalized: "Spotify", billingCycle: BillingCycle.CUSTOM }),
        subscription({ id: "a", vendorNormalized: "Adobe", billingCycle: BillingCycle.CUSTOM }),
        subscription({ id: "c", vendorNormalized: "Zoom", billingCycle: BillingCycle.CUSTOM, nextRenewalDate: day("2026-11-03") }),
      ],
      day("2026-11-01"),
      day("2026-11-30"),
    );
    expect(result.map((item) => item.vendor)).toEqual(["Zoom", "Adobe", "Spotify"]);
  });
});

describe("calendar month helpers", () => {
  it("builds Monday-first weeks padded with neighbouring days", () => {
    // 1 November 2026 is a Sunday; 30 November is a Monday.
    const calendar = buildCalendarMonth(2026, 11);
    expect(calendar.weeks).toHaveLength(6);
    expect(calendar.weeks.every((week) => week.length === 7)).toBe(true);
    expect(calendar.weeks[0][0]).toEqual({ dateKey: "2026-10-26", day: 26, inMonth: false });
    expect(calendar.weeks[0][6]).toEqual({ dateKey: "2026-11-01", day: 1, inMonth: true });
    expect(calendar.weeks[5][0]).toEqual({ dateKey: "2026-11-30", day: 30, inMonth: true });
    expect(calendar.weeks[5][6].dateKey).toBe("2026-12-06");
    expect(calendar.gridStart.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(calendar.gridEnd.toISOString()).toBe("2026-12-06T00:00:00.000Z");
  });

  it("builds a four-week grid for a February that starts on a Monday", () => {
    const calendar = buildCalendarMonth(2027, 2);
    expect(calendar.weeks).toHaveLength(4);
    expect(calendar.weeks.flat().every((item) => item.inMonth)).toBe(true);
  });

  it("parses and formats the month parameter", () => {
    expect(parseMonthParam("2026-11")).toEqual({ year: 2026, month: 11 });
    expect(formatMonthParam(2026, 3)).toBe("2026-03");
    for (const bad of [undefined, null, "", "2026-13", "2026-00", "2026-1", "1999-12", "2101-01", "2026-11-01", "abcd-ef"]) {
      expect(parseMonthParam(bad)).toBeNull();
    }
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(addUtcMonthsClamped(day("2026-03-31"), -1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("totals per currency without combining currencies", () => {
    const occurrences = projectRenewals(
      [
        subscription({ id: "a", priceAmountCents: 1000 }),
        subscription({ id: "b", priceAmountCents: 250 }),
        subscription({ id: "c", priceAmountCents: 900, priceCurrency: "EUR" }),
      ],
      day("2026-11-01"),
      day("2026-11-30"),
    );
    expect(totalsByCurrency(occurrences)).toEqual([
      { currency: "EUR", totalCents: 900, count: 1 },
      { currency: "USD", totalCents: 1250, count: 2 },
    ]);
  });
});

describe("SubscriptionService.listRenewalOccurrences", () => {
  async function seeded() {
    const { subscriptions, audit } = createInMemoryPersistence();
    const svc = new SubscriptionService(subscriptions, audit);
    const mine = await svc.create("user_1", {
      vendor: "Netflix",
      priceAmount: 15.99,
      currency: "USD",
      billingCycle: "monthly",
      nextRenewalDate: "2026-11-15",
    });
    const canceled = await svc.create("user_1", {
      vendor: "Hulu",
      priceAmount: 7.99,
      currency: "USD",
      billingCycle: "monthly",
      nextRenewalDate: "2026-11-20",
    });
    await svc.cancel("user_1", canceled.id);
    await svc.create("user_2", {
      vendor: "Spotify",
      priceAmount: 9.99,
      currency: "USD",
      billingCycle: "monthly",
      nextRenewalDate: "2026-11-16",
    });
    return { svc, mine };
  }

  it("returns only the caller's active subscriptions", async () => {
    const { svc, mine } = await seeded();
    const result = await svc.listRenewalOccurrences("user_1", day("2026-11-01"), day("2026-11-30"));
    expect(result.map((item) => item.subscriptionId)).toEqual([mine.id]);
    expect(await svc.listRenewalOccurrences("nobody", day("2026-11-01"), day("2026-11-30"))).toEqual([]);
  });

  it("rejects reversed, invalid and over-long ranges", async () => {
    const { svc } = await seeded();
    await expect(svc.listRenewalOccurrences("user_1", day("2026-12-01"), day("2026-11-01"))).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.listRenewalOccurrences("user_1", new Date("nope"), day("2026-11-01"))).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.listRenewalOccurrences("user_1", day("2026-01-01"), day("2027-06-01"))).rejects.toBeInstanceOf(ValidationError);
  });
});
