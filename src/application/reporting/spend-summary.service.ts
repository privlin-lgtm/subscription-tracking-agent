import type { FxRate } from "@/domain/ports";
import type { SubscriptionRecord } from "@/domain/repositories";
import { convertTotals, type ConvertedTotal, type FxUnavailableReason } from "@/application/fx/fx-conversion";

export type CurrencyTotal = {
  currency: string;
  /** Monthly-equivalent total in integer minor units of `currency`. */
  totalCents: number;
  /** Subscriptions counted in `totalCents` (excluded ones are not counted here). */
  subscriptionCount: number;
};

/** What every amount in a summary means: the cost of one month. */
export type SpendPeriod = "monthly";

type SpendSummaryCommon = {
  /** Every total in the summary is a monthly equivalent, whatever each plan's own cycle. */
  period: SpendPeriod;
  /**
   * Active/inactive subscriptions left out of every total because their billing cycle is
   * CUSTOM (which is also how "unknown" is stored), so a monthly cost cannot be worked out.
   */
  excludedCount: number;
};

export type SpendSummary =
  | (SpendSummaryCommon & {
      mixed: false;
      currency: string;
      totalCents: number;
      subscriptionCount: number;
    })
  | (SpendSummaryCommon & {
      mixed: true;
      /** Per-currency monthly totals in native currency. Always present, never converted. */
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
    });

export type SpendItem = Pick<SubscriptionRecord, "status" | "priceAmountCents" | "priceCurrency" | "billingCycle">;

/** Integer division rounded half-up (exact halves go up). Both arguments are non-negative integers. */
function divideHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/**
 * What one subscription costs per month, in integer minor units, or null when that cannot
 * be known.
 *
 * - MONTHLY: the price as stored.
 * - ANNUAL: price / 12.
 * - WEEKLY: price x 52 / 12 (52 weeks a year, spread over 12 months).
 * - CUSTOM, or anything else: null. A cycle is never guessed.
 *
 * Rounding: each item is rounded half-up to a whole minor unit here, before any adding, so
 * a total is always the sum of the per-item figures a person could check by hand.
 */
export function monthlyEquivalentCents(item: Pick<SubscriptionRecord, "priceAmountCents" | "billingCycle">): number | null {
  switch (item.billingCycle) {
    case "MONTHLY":
      return item.priceAmountCents;
    case "ANNUAL":
      return divideHalfUp(item.priceAmountCents, 12);
    case "WEEKLY":
      return divideHalfUp(item.priceAmountCents * 52, 12);
    default:
      return null;
  }
}

/** Stored FX state needed to convert a summary. Loaded by the caller; never fetched here. */
export type SpendFxContext = {
  displayCurrency: string;
  baseCurrency: string;
  rates: FxRate[];
  now: Date;
  maxRateAgeDays: number;
};

/**
 * Monthly spend summary, with the reporting-layer mixed-currency guard (architecture review #6).
 *
 * Every subscription is first turned into its monthly equivalent (`monthlyEquivalentCents`);
 * one whose cycle is CUSTOM is left out of the totals and counted in `excludedCount` instead.
 * Native amounts are never summed across ISO 4217 codes: `byCurrency` is always the
 * per-currency truth. When stored FX rates are supplied and every one needed is present and
 * fresh, an approximate `converted` total in the display currency is added alongside it.
 * Otherwise the summary keeps `MIXED_CURRENCY_NO_FX`, so a total is never silently wrong.
 */
export function summarizeSpend(
  subscriptions: SpendItem[],
  fx?: SpendFxContext,
): SpendSummary {
  const active = subscriptions.filter((item) => item.status === "ACTIVE" || item.status === "INACTIVE");
  const totals = new Map<string, CurrencyTotal>();
  let excludedCount = 0;

  for (const item of active) {
    const monthlyCents = monthlyEquivalentCents(item);
    if (monthlyCents === null) {
      excludedCount += 1;
      continue;
    }
    const current = totals.get(item.priceCurrency) ?? {
      currency: item.priceCurrency,
      totalCents: 0,
      subscriptionCount: 0,
    };
    current.totalCents += monthlyCents;
    current.subscriptionCount += 1;
    totals.set(item.priceCurrency, current);
  }

  const common: SpendSummaryCommon = { period: "monthly", excludedCount };
  const byCurrency = [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  if (byCurrency.length <= 1) {
    // Nothing countable: label the zero with the currency the user actually has, if any.
    const only = byCurrency[0] ?? { currency: active[0]?.priceCurrency ?? "USD", totalCents: 0, subscriptionCount: 0 };
    return {
      ...common,
      mixed: false,
      currency: only.currency,
      totalCents: only.totalCents,
      subscriptionCount: only.subscriptionCount,
    };
  }

  if (!fx) {
    return { ...common, mixed: true, warning: "MIXED_CURRENCY_NO_FX", byCurrency };
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
    return { ...common, mixed: true, warning: "MIXED_CURRENCY_NO_FX", fxUnavailable: result.reason, byCurrency };
  }
  return { ...common, mixed: true, byCurrency, converted: result.converted };
}
