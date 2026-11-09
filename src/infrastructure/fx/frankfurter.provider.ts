import { z } from "zod";
import type { FxRate, FxRateProvider } from "@/domain/ports";

// Shape of GET /v2/rates (https://frankfurter.dev, OpenAPI at /v2/openapi.json): a JSON array
// with one row per quote currency. Each row carries its own date, because the blended feed
// combines central banks that publish on different days.
const ratesSchema = z.array(
  z.object({
    date: z.string(),
    base: z.string(),
    quote: z.string(),
    rate: z.number(),
  }),
);

const REQUEST_TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Frankfurter: free, keyless daily reference rates from central banks.
 *
 * Privacy: the only thing sent is the base currency code, in the query string. No user
 * identifiers, amounts, vendors or anything else derived from user data leave the app.
 *
 * The request deliberately omits the `quotes` filter and filters the response here instead:
 * Frankfurter rejects the whole request if any one requested code is unknown to it, which
 * would let a single odd currency on one subscription block every other rate.
 */
export class FrankfurterRateProvider implements FxRateProvider {
  readonly source = "frankfurter";

  constructor(
    private readonly apiBaseUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async fetchLatest(base: string, quotes: string[]): Promise<FxRate[]> {
    const url = `${this.apiBaseUrl.replace(/\/+$/, "")}/v2/rates?base=${encodeURIComponent(base)}`;
    const response = await this.fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Frankfurter responded with HTTP ${response.status}`);
    }
    const parsed = ratesSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error("Frankfurter returned an unexpected response shape");
    }
    const wanted = new Set(quotes.map((code) => code.toUpperCase()));
    return parsed.data
      .filter((row) => wanted.has(row.quote.toUpperCase()))
      .map((row) => ({
        base: row.base.toUpperCase(),
        quote: row.quote.toUpperCase(),
        rate: row.rate,
        rateDate: row.date,
        source: this.source,
      }));
  }
}
