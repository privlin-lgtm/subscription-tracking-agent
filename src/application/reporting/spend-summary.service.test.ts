import { describe, expect, it } from "vitest";
import { monthlyEquivalentCents, summarizeSpend, type SpendItem } from "@/application/reporting/spend-summary.service";

describe("spend summary mixed-currency guard", () => {
  it("totals a single currency", () => {
    const summary = summarizeSpend([
      { status: "ACTIVE", priceAmountCents: 999, priceCurrency: "USD", billingCycle: "MONTHLY" },
      { status: "ACTIVE", priceAmountCents: 1500, priceCurrency: "USD", billingCycle: "MONTHLY" },
      { status: "CANCELED", priceAmountCents: 5000, priceCurrency: "USD", billingCycle: "MONTHLY" },
    ]);
    expect(summary).toEqual({
      period: "monthly",
      excludedCount: 0,
      mixed: false,
      currency: "USD",
      totalCents: 2499,
      subscriptionCount: 2,
    });
  });

  it("never sums mixed currencies together", () => {
    const summary = summarizeSpend([
      { status: "ACTIVE", priceAmountCents: 1000, priceCurrency: "USD", billingCycle: "MONTHLY" },
      { status: "ACTIVE", priceAmountCents: 2000, priceCurrency: "EUR", billingCycle: "MONTHLY" },
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
    { status: "ACTIVE" as const, priceAmountCents: 5990, priceCurrency: "ILS", billingCycle: "MONTHLY" as const },
    { status: "ACTIVE" as const, priceAmountCents: 1000, priceCurrency: "USD", billingCycle: "MONTHLY" as const },
    { status: "CANCELED" as const, priceAmountCents: 9900, priceCurrency: "EUR", billingCycle: "MONTHLY" as const },
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
      period: "monthly",
      excludedCount: 0,
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
      period: "monthly",
      excludedCount: 0,
      mixed: true,
      warning: "MIXED_CURRENCY_NO_FX",
      fxUnavailable: "RATE_MISSING",
      byCurrency,
    });
  });

  it("falls back to MIXED_CURRENCY_NO_FX with no total when the rate is stale", () => {
    const summary = summarizeSpend(subscriptions, { ...fx, rates: [usd("2026-10-30")] });
    expect(summary).toEqual({
      period: "monthly",
      excludedCount: 0,
      mixed: true,
      warning: "MIXED_CURRENCY_NO_FX",
      fxUnavailable: "RATE_STALE",
      byCurrency,
    });
  });

  it("never converts a single-currency summary", () => {
    const summary = summarizeSpend(
      [{ status: "ACTIVE", priceAmountCents: 1000, priceCurrency: "USD", billingCycle: "MONTHLY" }],
      { ...fx, rates: [usd("2026-11-09")] },
    );
    expect(summary).toEqual({
      period: "monthly",
      excludedCount: 0,
      mixed: false,
      currency: "USD",
      totalCents: 1000,
      subscriptionCount: 1,
    });
  });
});

const item = (
  priceAmountCents: number,
  billingCycle: SpendItem["billingCycle"],
  priceCurrency = "ILS",
  status: SpendItem["status"] = "ACTIVE",
): SpendItem => ({ status, priceAmountCents, priceCurrency, billingCycle });

describe("monthly equivalent of one subscription", () => {
  it("keeps a monthly price as it is", () => {
    expect(monthlyEquivalentCents({ priceAmountCents: 1549, billingCycle: "MONTHLY" })).toBe(1549);
  });

  it("divides an annual price by 12", () => {
    expect(monthlyEquivalentCents({ priceAmountCents: 12000, billingCycle: "ANNUAL" })).toBe(1000);
  });

  it("multiplies a weekly price by 52/12", () => {
    // 3.00 a week = 156.00 a year = 13.00 a month.
    expect(monthlyEquivalentCents({ priceAmountCents: 300, billingCycle: "WEEKLY" })).toBe(1300);
  });

  it("rounds each item half-up to a whole minor unit", () => {
    // 499.00 / 12 = 41.5833 -> 41.58 (down); 85.90 / 12 = 7.1583 -> 7.16 (up)
    expect(monthlyEquivalentCents({ priceAmountCents: 49900, billingCycle: "ANNUAL" })).toBe(4158);
    expect(monthlyEquivalentCents({ priceAmountCents: 8590, billingCycle: "ANNUAL" })).toBe(716);
    // Exact halves go up: 0.06 / 12 = 0.5 cent -> 1; 0.18 / 12 = 1.5 -> 2.
    expect(monthlyEquivalentCents({ priceAmountCents: 6, billingCycle: "ANNUAL" })).toBe(1);
    expect(monthlyEquivalentCents({ priceAmountCents: 18, billingCycle: "ANNUAL" })).toBe(2);
    expect(monthlyEquivalentCents({ priceAmountCents: 5, billingCycle: "ANNUAL" })).toBe(0);
    // 9.99 a week x 52 / 12 = 43.29 exactly; 1.00 a week = 4.3333 -> 4.33; 0.05 = 0.2167 -> 0.22.
    expect(monthlyEquivalentCents({ priceAmountCents: 999, billingCycle: "WEEKLY" })).toBe(4329);
    expect(monthlyEquivalentCents({ priceAmountCents: 100, billingCycle: "WEEKLY" })).toBe(433);
    expect(monthlyEquivalentCents({ priceAmountCents: 5, billingCycle: "WEEKLY" })).toBe(22);
  });

  it("gives no figure for a custom cycle, or for a value it does not know", () => {
    expect(monthlyEquivalentCents({ priceAmountCents: 1000, billingCycle: "CUSTOM" })).toBeNull();
    expect(
      monthlyEquivalentCents({ priceAmountCents: 1000, billingCycle: "QUARTERLY" as unknown as SpendItem["billingCycle"] }),
    ).toBeNull();
  });
});

describe("spend summary is a monthly figure", () => {
  it("counts annual and weekly plans at their monthly cost", () => {
    const summary = summarizeSpend([item(1000, "MONTHLY"), item(12000, "ANNUAL"), item(300, "WEEKLY")]);
    expect(summary).toEqual({
      period: "monthly",
      excludedCount: 0,
      mixed: false,
      currency: "ILS",
      totalCents: 1000 + 1000 + 1300,
      subscriptionCount: 3,
    });
  });

  it("rounds per item before adding, not once on the sum", () => {
    // Three annual plans of 0.05: each is 0.4167 cents a month and rounds to 0, so the total is 0.
    // Rounding the sum instead (0.15 / 12 = 1.25 cents) would give 1.
    const summary = summarizeSpend([item(5, "ANNUAL"), item(5, "ANNUAL"), item(5, "ANNUAL")]);
    expect(summary).toMatchObject({ mixed: false, totalCents: 0, subscriptionCount: 3 });
  });

  it("leaves custom-cycle subscriptions out of the total and counts them", () => {
    const summary = summarizeSpend([
      item(1000, "MONTHLY"),
      item(99900, "CUSTOM"),
      item(5000, "CUSTOM", "USD"),
      item(7000, "CUSTOM", "ILS", "CANCELED"),
    ]);
    // The USD item is excluded, so it does not make the summary mixed either. The canceled
    // one is not reportable at all, so it is not counted as excluded.
    expect(summary).toEqual({
      period: "monthly",
      excludedCount: 2,
      mixed: false,
      currency: "ILS",
      totalCents: 1000,
      subscriptionCount: 1,
    });
  });

  it("reports the excluded count on a mixed-currency summary too", () => {
    const summary = summarizeSpend([item(1000, "MONTHLY"), item(2400, "ANNUAL", "USD"), item(500, "CUSTOM", "USD")]);
    expect(summary).toEqual({
      period: "monthly",
      excludedCount: 1,
      mixed: true,
      warning: "MIXED_CURRENCY_NO_FX",
      byCurrency: [
        { currency: "ILS", totalCents: 1000, subscriptionCount: 1 },
        { currency: "USD", totalCents: 200, subscriptionCount: 1 },
      ],
    });
  });

  it("shows zero in the user's own currency when every subscription is excluded", () => {
    expect(summarizeSpend([item(4500, "CUSTOM")])).toEqual({
      period: "monthly",
      excludedCount: 1,
      mixed: false,
      currency: "ILS",
      totalCents: 0,
      subscriptionCount: 0,
    });
    expect(summarizeSpend([])).toEqual({
      period: "monthly",
      excludedCount: 0,
      mixed: false,
      currency: "USD",
      totalCents: 0,
      subscriptionCount: 0,
    });
  });

  it("converts the monthly per-currency totals, not the stored prices", () => {
    // 120.00 USD a year is 10.00 USD a month = 40.00 ILS at 0.25 USD per ILS.
    const summary = summarizeSpend([item(5000, "MONTHLY"), item(12000, "ANNUAL", "USD")], {
      displayCurrency: "ILS",
      baseCurrency: "ILS",
      now: new Date("2026-11-09T12:00:00Z"),
      maxRateAgeDays: 7,
      rates: [{ base: "ILS", quote: "USD", rate: 0.25, rateDate: "2026-11-09", source: "frankfurter" }],
    });
    expect(summary).toMatchObject({
      byCurrency: [
        { currency: "ILS", totalCents: 5000, subscriptionCount: 1 },
        { currency: "USD", totalCents: 1000, subscriptionCount: 1 },
      ],
      converted: { currency: "ILS", totalCents: 9000 },
    });
  });
});

describe("spend summary for the real mix of plans (17 subscriptions, 4 of them annual)", () => {
  const ilsMonthly = [74500, 990, 1000, 800, 320, 390, 9980, 11682, 3900];
  const ilsAnnual = [49900, 3600, 8590, 8500];
  const usdMonthly = [1000, 2000, 2000, 599];
  const subscriptions = [
    ...ilsMonthly.map((cents) => item(cents, "MONTHLY")),
    ...ilsAnnual.map((cents) => item(cents, "ANNUAL")),
    ...usdMonthly.map((cents) => item(cents, "MONTHLY", "USD")),
  ];

  it("gives 41.58 + 3.00 + 7.16 + 7.08 = 58.82 a month for the four annual plans", () => {
    expect(ilsAnnual.map((cents) => monthlyEquivalentCents({ priceAmountCents: cents, billingCycle: "ANNUAL" }))).toEqual([
      4158, 300, 716, 708,
    ]);
  });

  it("totals exactly ILS 1,094.44 and USD 55.99 a month", () => {
    const summary = summarizeSpend(subscriptions);
    expect(summary).toEqual({
      period: "monthly",
      excludedCount: 0,
      mixed: true,
      warning: "MIXED_CURRENCY_NO_FX",
      byCurrency: [
        { currency: "ILS", totalCents: 109444, subscriptionCount: 13 },
        { currency: "USD", totalCents: 5599, subscriptionCount: 4 },
      ],
    });
  });

  it("converts those monthly totals into one figure", () => {
    const summary = summarizeSpend(subscriptions, {
      displayCurrency: "ILS",
      baseCurrency: "ILS",
      now: new Date("2026-11-10T12:00:00Z"),
      maxRateAgeDays: 7,
      // 1 ILS = 0.3157 USD, so 55.99 USD = 177.35 ILS.
      rates: [{ base: "ILS", quote: "USD", rate: 0.3157, rateDate: "2026-11-10", source: "frankfurter" }],
    });
    expect(summary).toMatchObject({
      mixed: true,
      converted: { currency: "ILS", totalCents: 109444 + 17735, rateDate: "2026-11-10" },
    });
  });
});
