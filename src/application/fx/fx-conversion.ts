import type { FxRate } from "@/domain/ports";
import { minorUnitsFor } from "@/domain/value-objects/money";

const DAY_MS = 24 * 60 * 60 * 1000;

export type FxUnavailableReason = "RATE_MISSING" | "RATE_STALE";

export type ConvertedTotal = {
  /** ISO 4217 display currency the total is expressed in. */
  currency: string;
  /** Integer minor units of `currency`. */
  totalCents: number;
  /** "YYYY-MM-DD": the oldest publication date among the rates that went into the total. */
  rateDate: string;
  /** Where the rates came from (e.g. "frankfurter"). */
  source: string;
  /** Always true: a converted total is an estimate at a daily reference rate, never an exact charge. */
  approximate: true;
};

export type ConversionResult =
  | { ok: true; converted: ConvertedTotal }
  | { ok: false; reason: FxUnavailableReason; currencies: string[] };

export type ConversionInput = {
  /** Per-currency totals in integer minor units. */
  totals: Array<{ currency: string; totalCents: number }>;
  displayCurrency: string;
  /** Stored rates. Rows whose base differs from `baseCurrency` are ignored. */
  rates: FxRate[];
  /** The currency every usable rate is quoted against (1 base = rate quote). */
  baseCurrency: string;
  now: Date;
  maxRateAgeDays: number;
};

/** Whole days between a "YYYY-MM-DD" rate date and `now`, both taken as UTC calendar days. */
export function rateAgeDays(rateDate: string, now: Date): number {
  const published = Date.parse(`${rateDate}T00:00:00Z`);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - published) / DAY_MS);
}

/**
 * Converts per-currency totals into one total in the display currency.
 *
 * All-or-nothing: if any currency involved has no stored rate, or its rate is older than
 * `maxRateAgeDays`, nothing is returned — a partial or outdated total would be silently wrong.
 *
 * Rounding: each currency's subtotal is converted on its own and rounded half-up to the
 * display currency's minor unit, then the rounded subtotals are added. Amounts stay integers
 * throughout; only the rate itself is a floating-point number.
 */
export function convertTotals(input: ConversionInput): ConversionResult {
  const display = input.displayCurrency;
  const byQuote = new Map<string, FxRate>();
  for (const row of input.rates) {
    if (row.base === input.baseCurrency && Number.isFinite(row.rate) && row.rate > 0) {
      byQuote.set(row.quote, row);
    }
  }

  // Units of `currency` per one unit of the base currency.
  const perBase = (currency: string): FxRate | "base" | null =>
    currency === input.baseCurrency ? "base" : (byQuote.get(currency) ?? null);

  const foreign = input.totals.filter((row) => row.currency !== display).map((row) => row.currency);
  const involved = foreign.length > 0 ? [...new Set([...foreign, display])] : [];

  const missing = involved.filter((currency) => perBase(currency) === null);
  if (missing.length > 0) {
    return { ok: false, reason: "RATE_MISSING", currencies: missing.sort() };
  }

  const used = involved
    .map((currency) => perBase(currency))
    .filter((row): row is FxRate => row !== null && row !== "base");
  const stale = used.filter((row) => rateAgeDays(row.rateDate, input.now) > input.maxRateAgeDays);
  if (stale.length > 0) {
    return { ok: false, reason: "RATE_STALE", currencies: stale.map((row) => row.quote).sort() };
  }

  const unitsPerBase = (currency: string): number => {
    const row = perBase(currency);
    return row === "base" || row === null ? 1 : row.rate;
  };

  let totalCents = 0;
  for (const row of input.totals) {
    if (row.currency === display) {
      totalCents += row.totalCents;
      continue;
    }
    const major = row.totalCents / minorUnitsFor(row.currency);
    const inDisplay = (major * unitsPerBase(display)) / unitsPerBase(row.currency);
    totalCents += Math.round(inDisplay * minorUnitsFor(display));
  }

  const rateDate = used.map((row) => row.rateDate).sort()[0] ?? input.now.toISOString().slice(0, 10);
  const source = [...new Set(used.map((row) => row.source))].sort().join(", ");
  return { ok: true, converted: { currency: display, totalCents, rateDate, source, approximate: true } };
}
