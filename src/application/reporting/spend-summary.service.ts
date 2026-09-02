import type { SubscriptionRecord } from "@/domain/repositories";

export type CurrencyTotal = {
  currency: string;
  totalCents: number;
  subscriptionCount: number;
};

export type SpendSummary =
  | {
      mixed: false;
      currency: string;
      totalCents: number;
      subscriptionCount: number;
    }
  | {
      mixed: true;
      warning: "MIXED_CURRENCY_NO_FX";
      byCurrency: CurrencyTotal[];
    };

/**
 * Reporting-layer mixed-currency guard (architecture review #6).
 * Never sums amounts across ISO 4217 codes. FX conversion is out of MVP scope.
 */
export function summarizeSpend(
  subscriptions: Array<Pick<SubscriptionRecord, "status" | "priceAmountCents" | "priceCurrency">>,
): SpendSummary {
  const active = subscriptions.filter((item) => item.status === "ACTIVE" || item.status === "INACTIVE");
  const totals = new Map<string, CurrencyTotal>();

  for (const item of active) {
    const current = totals.get(item.priceCurrency) ?? {
      currency: item.priceCurrency,
      totalCents: 0,
      subscriptionCount: 0,
    };
    current.totalCents += item.priceAmountCents;
    current.subscriptionCount += 1;
    totals.set(item.priceCurrency, current);
  }

  const byCurrency = [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  if (byCurrency.length <= 1) {
    const only = byCurrency[0] ?? { currency: "USD", totalCents: 0, subscriptionCount: 0 };
    return {
      mixed: false,
      currency: only.currency,
      totalCents: only.totalCents,
      subscriptionCount: only.subscriptionCount,
    };
  }

  return {
    mixed: true,
    warning: "MIXED_CURRENCY_NO_FX",
    byCurrency,
  };
}
