import type { Clock, FxRate, FxRateProvider } from "@/domain/ports";
import type { CurrencyUsageRepository, ExchangeRateRepository } from "@/domain/repositories";
import { DISPLAY_CURRENCY_OPTIONS } from "@/shared/display-currencies";
import { isIso4217 } from "@/shared/iso-4217";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type FxRefreshResult = {
  base: string;
  requested: string[];
  stored: number;
  /** Requested currencies the provider returned no usable rate for. */
  missing: string[];
};

/**
 * Daily job: fetch the latest rates for every currency in use and store them. Reports only
 * ever read the stored rows, so a provider outage never touches a request — yesterday's
 * rates simply stay in place until they pass the staleness limit.
 */
export class FxRateJob {
  constructor(
    private readonly provider: FxRateProvider,
    private readonly rates: ExchangeRateRepository,
    private readonly usage: CurrencyUsageRepository,
    private readonly clock: Clock,
    private readonly baseCurrency: string,
  ) {}

  async run(): Promise<FxRefreshResult> {
    const inUse = await this.usage.listCurrenciesInUse();
    const requested = [
      ...new Set([...inUse, ...DISPLAY_CURRENCY_OPTIONS].map((code) => code.trim().toUpperCase())),
    ]
      .filter((code) => isIso4217(code) && code !== this.baseCurrency)
      .sort();

    if (requested.length === 0) {
      return { base: this.baseCurrency, requested, stored: 0, missing: [] };
    }

    const fetched = await this.provider.fetchLatest(this.baseCurrency, requested);

    // Never trust the provider's payload blindly: keep only rows for the pair we asked
    // about, with a positive finite rate and a real calendar date.
    const wanted = new Set(requested);
    const usable = new Map<string, FxRate>();
    for (const row of fetched) {
      const quote = row.quote.toUpperCase();
      if (
        row.base.toUpperCase() !== this.baseCurrency ||
        !wanted.has(quote) ||
        !Number.isFinite(row.rate) ||
        row.rate <= 0 ||
        !ISO_DATE.test(row.rateDate) ||
        Number.isNaN(Date.parse(`${row.rateDate}T00:00:00Z`))
      ) {
        continue;
      }
      usable.set(quote, { ...row, base: this.baseCurrency, quote });
    }

    await this.rates.saveRates([...usable.values()], this.clock.now());
    return {
      base: this.baseCurrency,
      requested,
      stored: usable.size,
      missing: requested.filter((code) => !usable.has(code)),
    };
  }
}
