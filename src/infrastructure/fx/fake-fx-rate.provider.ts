import type { FxRate, FxRateProvider } from "@/domain/ports";

/**
 * In-memory FxRateProvider for tests and offline runs: no network. Rates are given per base
 * as `{ USD: 0.31, EUR: 0.28 }`, meaning 1 base = that many units of the quote.
 */
export class FakeFxRateProvider implements FxRateProvider {
  readonly source: string;
  readonly calls: Array<{ base: string; quotes: string[] }> = [];
  failWith: Error | null = null;
  /** Extra rows returned verbatim, for exercising how callers treat a bad payload. */
  extraRows: FxRate[] = [];

  constructor(
    private readonly ratesPerBase: Record<string, number>,
    private readonly rateDate: string,
    source = "fake",
  ) {
    this.source = source;
  }

  async fetchLatest(base: string, quotes: string[]): Promise<FxRate[]> {
    this.calls.push({ base, quotes: [...quotes] });
    if (this.failWith) {
      throw this.failWith;
    }
    const rows: FxRate[] = [];
    for (const quote of quotes) {
      const rate = this.ratesPerBase[quote];
      if (rate !== undefined) {
        rows.push({ base, quote, rate, rateDate: this.rateDate, source: this.source });
      }
    }
    return [...rows, ...this.extraRows];
  }
}
