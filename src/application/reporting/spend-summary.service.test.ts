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
