import { describe, expect, it } from "vitest";
import { summarizeSpend } from "@/application/reporting/spend-summary.service";

describe("spend summary mixed-currency guard", () => {
  it("totals a single currency", () => {
    const summary = summarizeSpend([
      { status: "ACTIVE", priceAmountCents: 999, priceCurrency: "USD" },
      { status: "ACTIVE", priceAmountCents: 1500, priceCurrency: "USD" },
      { status: "CANCELED", priceAmountCents: 5000, priceCurrency: "USD" },
    ]);
    expect(summary).toEqual({
      mixed: false,
      currency: "USD",
      totalCents: 2499,
      subscriptionCount: 2,
    });
  });

  it("never sums mixed currencies together", () => {
    const summary = summarizeSpend([
      { status: "ACTIVE", priceAmountCents: 1000, priceCurrency: "USD" },
      { status: "ACTIVE", priceAmountCents: 2000, priceCurrency: "EUR" },
    ]);
    expect(summary.mixed).toBe(true);
    if (summary.mixed) {
      expect(summary.warning).toBe("MIXED_CURRENCY_NO_FX");
      expect(summary.byCurrency).toEqual([
        { currency: "EUR", totalCents: 2000, subscriptionCount: 1 },
        { currency: "USD", totalCents: 1000, subscriptionCount: 1 },
      ]);
    }
  });
});

describe("spend summary with stored FX rates", () => {
  const subscriptions = [
    { status: "ACTIVE" as const, priceAmountCents: 5990, priceCurrency: "ILS" },
    { status: "ACTIVE" as const, priceAmountCents: 1000, priceCurrency: "USD" },
    { status: "CANCELED" as const, priceAmountCents: 9900, priceCurrency: "EUR" },
  ];
  const byCurrency = [
    { currency: "ILS", totalCents: 5990, subscriptionCount: 1 },
    { currency: "USD", totalCents: 1000, subscriptionCount: 1 },
  ];
  const fx = {
    displayCurrency: "ILS",
    baseCurrency: "ILS",
    now: new Date("2026-11-09T12:00:00Z"),
    maxRateAgeDays: 7,
  };
  const usd = (rateDate: string) => ({ base: "ILS", quote: "USD", rate: 0.25, rateDate, source: "frankfurter" });

  it("adds an approximate converted total next to an unchanged byCurrency breakdown", () => {
    const summary = summarizeSpend(subscriptions, { ...fx, rates: [usd("2026-11-09")] });
    expect(summary).toEqual({
      mixed: true,
      byCurrency,
      converted: {
        currency: "ILS",
        totalCents: 9990,
        rateDate: "2026-11-09",
        source: "frankfurter",
        approximate: true,
      },
    });
  });

  it("falls back to MIXED_CURRENCY_NO_FX with no total when a rate is missing", () => {
    const summary = summarizeSpend(subscriptions, { ...fx, rates: [] });
    expect(summary).toEqual({
      mixed: true,
      warning: "MIXED_CURRENCY_NO_FX",
      fxUnavailable: "RATE_MISSING",
      byCurrency,
    });
  });

  it("falls back to MIXED_CURRENCY_NO_FX with no total when the rate is stale", () => {
    const summary = summarizeSpend(subscriptions, { ...fx, rates: [usd("2026-10-30")] });
    expect(summary).toEqual({
      mixed: true,
      warning: "MIXED_CURRENCY_NO_FX",
      fxUnavailable: "RATE_STALE",
      byCurrency,
    });
  });

  it("leaves a single-currency summary exactly as before", () => {
    const summary = summarizeSpend(
      [{ status: "ACTIVE", priceAmountCents: 1000, priceCurrency: "USD" }],
      { ...fx, rates: [usd("2026-11-09")] },
    );
    expect(summary).toEqual({ mixed: false, currency: "USD", totalCents: 1000, subscriptionCount: 1 });
  });
});
