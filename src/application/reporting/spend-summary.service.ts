import type { FxRate } from "@/domain/ports";
import type { SubscriptionRecord } from "@/domain/repositories";
import { convertTotals, type ConvertedTotal, type FxUnavailableReason } from "@/application/fx/fx-conversion";

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
      /** Per-currency totals in native currency. Always present, never converted. */
      byCurrency: CurrencyTotal[];
      /**
       * Approximate total in the user's display currency. Present only when every currency
       * involved has a stored rate that is fresh enough.
       */
      converted?: ConvertedTotal;
      /** Set exactly when `converted` is absent: the totals could not be combined. */
      warning?: "MIXED_CURRENCY_NO_FX";
      /** Why conversion was not possible (only when FX was attempted and failed). */
      fxUnavailable?: FxUnavailableReason;
    };

/** Stored FX state needed to convert a summary. Loaded by the caller; never fetched here. */
export type SpendFxContext = {
  displayCurrency: string;
  baseCurrency: string;
  rates: FxRate[];
  now: Date;
  maxRateAgeDays: number;
};

/**
 * Reporting-layer mixed-currency guard (architecture review #6).
 * Native amounts are never summed across ISO 4217 codes: `byCurrency` is always the
 * per-currency truth. When stored FX rates are supplied and every one needed is present and
 * fresh, an approximate `converted` total in the display currency is added alongside it.
 * Otherwise the summary keeps `MIXED_CURRENCY_NO_FX`, so a total is never silently wrong.
 */
export function summarizeSpend(
  subscriptions: Array<Pick<SubscriptionRecord, "status" | "priceAmountCents" | "priceCurrency">>,
  fx?: SpendFxContext,
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

  if (!fx) {
    return { mixed: true, warning: "MIXED_CURRENCY_NO_FX", byCurrency };
  }

  const result = convertTotals({
    totals: byCurrency,
    displayCurrency: fx.displayCurrency,
    rates: fx.rates,
    baseCurrency: fx.baseCurrency,
    now: fx.now,
    maxRateAgeDays: fx.maxRateAgeDays,
  });
  if (!result.ok) {
    return { mixed: true, warning: "MIXED_CURRENCY_NO_FX", fxUnavailable: result.reason, byCurrency };
  }
  return { mixed: true, byCurrency, converted: result.converted };
}
