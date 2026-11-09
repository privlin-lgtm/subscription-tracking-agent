import type { FxRate } from "@/domain/ports";
import type {
  CurrencyUsageRepository,
  ExchangeRateRepository,
  UserPreferencesRepository,
} from "@/domain/repositories";

/** Test doubles for the FX repositories (same role as in-memory-subscriptions.ts). */
export class InMemoryExchangeRates implements ExchangeRateRepository {
  rows = new Map<string, FxRate>();
  lastFetchedAt: Date | null = null;

  constructor(seed: FxRate[] = []) {
    for (const row of seed) {
      this.rows.set(`${row.base}:${row.quote}`, row);
    }
  }

  async saveRates(rates: FxRate[], fetchedAt: Date): Promise<void> {
    for (const row of rates) {
      this.rows.set(`${row.base}:${row.quote}`, row);
    }
    this.lastFetchedAt = fetchedAt;
  }

  async listByBase(base: string): Promise<FxRate[]> {
    return [...this.rows.values()].filter((row) => row.base === base);
  }
}

export class InMemoryCurrencyUsage implements CurrencyUsageRepository {
  constructor(public currencies: string[]) {}

  async listCurrenciesInUse(): Promise<string[]> {
    return this.currencies;
  }
}

export class InMemoryUserPreferences implements UserPreferencesRepository {
  displayCurrencies = new Map<string, string>();

  async getDisplayCurrency(userId: string): Promise<string | null> {
    return this.displayCurrencies.get(userId) ?? null;
  }

  async setDisplayCurrency(userId: string, currency: string): Promise<void> {
    this.displayCurrencies.set(userId, currency);
  }
}
